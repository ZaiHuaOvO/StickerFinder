import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import { NotConfiguredError } from '../../common/errors/provider.errors';
import { ProviderErrorCodeEnum } from '../../common/enums';
import { EveryInfraConfig } from './everyinfra.config';
import { classifyEveryInfraError, EveryInfraError } from './everyinfra-error';
import { EveryInfraUsageService } from './everyinfra.usage.service';
import {
  EveryInfraBilling,
  EveryInfraCallResult,
  EveryInfraPlatform,
} from './everyinfra.types';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function messageFrom(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['message', 'message_zh', 'msg', 'detail', 'error_description']) {
    const text = record[key];
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  const code = record['code'];
  return typeof code === 'string' ? code : null;
}

function looksLikeProduct(record: Record<string, unknown>): boolean {
  return [
    'title',
    'name',
    'product_id',
    'item_id',
    'offer_id',
    'url',
    'detail_url',
    'price',
    'price_cny',
    'price_min',
  ].some((key) => record[key] !== undefined && record[key] !== null);
}

/** results 不一定是数组：详情接口可能直接返回对象，因此两种形态都要支持。 */
function extractItems(body: Record<string, unknown>): unknown[] {
  const data = asRecord(body['data']);
  const arrays: unknown[] = [
    body['results'],
    data?.['results'],
    body['items'],
    data?.['items'],
    data?.['list'],
    body['list'],
    body['data'],
  ];
  for (const value of arrays) {
    if (Array.isArray(value)) return value;
  }

  const singleObjects: unknown[] = [
    // 实际 product_detail 把单个商品直接放在 results 对象中，不是数组。
    body['results'],
    data?.['results'],
    data?.['product'],
    data?.['item'],
    data?.['detail'],
    body['product'],
    body['item'],
    body['detail'],
    body['data'],
    body,
  ];
  for (const value of singleObjects) {
    const record = asRecord(value);
    if (record && looksLikeProduct(record)) return [record];
  }
  return [];
}

function extractCount(body: Record<string, unknown>): number | null {
  const data = asRecord(body['data']);
  for (const value of [
    body['count'],
    body['total'],
    body['total_count'],
    data?.['count'],
    data?.['total'],
  ]) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function extractBilling(body: Record<string, unknown>): EveryInfraBilling | null {
  const data = asRecord(body['data']);
  const source =
    asRecord(body['billing']) ??
    asRecord(data?.['billing']) ??
    asRecord(body['usage']) ??
    null;
  if (source) {
    return {
      charged:
        typeof source['charged'] === 'boolean' ? source['charged'] : undefined,
      charged_usd: asNumber(source['charged_usd']),
      balance_after_usd:
        asNumber(source['balance_after_usd']) ??
        asNumber(source['balance_usd']),
    };
  }
  const chargedUsd = asNumber(body['charged_usd']);
  if (chargedUsd === null && body['charged'] === undefined) return null;
  return {
    charged: typeof body['charged'] === 'boolean' ? body['charged'] : undefined,
    charged_usd: chargedUsd,
    balance_after_usd: asNumber(body['balance_after_usd']),
  };
}

function extractRequestId(
  body: Record<string, unknown>,
  headerValue: unknown,
): string | null {
  const data = asRecord(body['data']);
  const fromHeader = Array.isArray(headerValue)
    ? headerValue[0]
    : headerValue;
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }
  for (const value of [
    body['request_id'],
    body['requestId'],
    data?.['request_id'],
    data?.['requestId'],
  ]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  // EveryInfra 实际响应用顶层 id 返回请求 ID（req_...），与 x-request-id 一致。
  if (typeof body['id'] === 'string' && body['id'].startsWith('req_')) {
    return body['id'];
  }
  return null;
}

function extractBusinessError(body: Record<string, unknown>): string | null {
  const error = body['error'];
  if (error !== undefined && error !== null && error !== false && error !== '') {
    const message = messageFrom(error);
    if (message) return message;
  }
  if (body['success'] === false || body['ok'] === false) {
    return messageFrom(body) ?? '服务商返回 success=false';
  }
  if (body['status'] === 'error' || body['status'] === 'failed') {
    return messageFrom(body) ?? '服务商返回失败状态';
  }
  const code = body['code'];
  if (typeof code === 'string') {
    const normalized = code.trim().toLowerCase();
    if (normalized && !['ok', 'success', '0', '200'].includes(normalized)) {
      return messageFrom(body) ?? `服务商返回业务错误码 ${code}`;
    }
  }
  return null;
}

@Injectable()
export class EveryInfraClient {
  private readonly logger = new Logger(EveryInfraClient.name);

  constructor(
    private readonly config: EveryInfraConfig,
    private readonly usage: EveryInfraUsageService,
  ) {}

  isConfigured(platform: EveryInfraPlatform): boolean {
    return this.config.isAvailable(platform);
  }

  ensureConfigured(platform: EveryInfraPlatform): void {
    const reason = this.config.unavailableReason(platform);
    if (reason) {
      throw new NotConfiguredError(`EveryInfra ${platform} 未配置：${reason}`);
    }
  }

  /**
   * 统一入口：POST /api/v1/social。
   * 单次请求内不重试；余额不足/认证失败直接抛出稳定错误码。
   */
  async call(
    platform: EveryInfraPlatform,
    action: string,
    params: Record<string, unknown>,
  ): Promise<EveryInfraCallResult> {
    this.ensureConfigured(platform);

    const url = `${this.config.baseUrl}/api/v1/social`;
    const startedAt = Date.now();
    let response: AxiosResponse<unknown>;
    try {
      response = await axios.post(
        url,
        { platform, action, params },
        {
          timeout: this.config.timeoutMsFor(platform),
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );
    } catch (error) {
      const axiosError = axios.isAxiosError(error) ? error : null;
      const httpStatus = axiosError?.response?.status ?? null;
      const body = asRecord(axiosError?.response?.data) ?? {};
      const requestId = extractRequestId(
        body,
        axiosError?.response?.headers?.['x-request-id'],
      );
      const billing = extractBilling(body);
      const serviceMessage =
        messageFrom(body['error']) ??
        messageFrom(body) ??
        (axiosError?.message || String(error));
      const code = classifyEveryInfraError(
        httpStatus ?? undefined,
        serviceMessage,
      );
      const durationMs = Date.now() - startedAt;

      this.usage.record({
        at: new Date().toISOString(),
        platform,
        action,
        requestId,
        httpStatus,
        chargedUsd: billing?.charged_usd ?? null,
        balanceAfterUsd: billing?.balance_after_usd ?? null,
        durationMs,
        success: false,
        errorCode: code,
      });
      this.logger.warn(
        `[everyinfra] ${platform}/${action} 失败 code=${code} http=${httpStatus ?? '-'} req=${requestId ?? '-'} ${serviceMessage}`,
      );
      throw new EveryInfraError(
        code,
        `EveryInfra ${platform}/${action} 请求失败：${serviceMessage}`,
        {
          httpStatus: httpStatus ?? undefined,
          requestId,
          billing,
          details: `HTTP ${httpStatus ?? 'unknown'} ${requestId ? `req=${requestId}` : ''}`.trim(),
        },
      );
    }

    const body = asRecord(response.data) ?? {};
    const httpStatus = response.status;
    const requestId = extractRequestId(
      body,
      response.headers?.['x-request-id'],
    );
    const billing = extractBilling(body);
    const durationMs = Date.now() - startedAt;
    const businessError = extractBusinessError(body);

    if (businessError) {
      const code = classifyEveryInfraError(httpStatus, businessError);
      this.usage.record({
        at: new Date().toISOString(),
        platform,
        action,
        requestId,
        httpStatus,
        chargedUsd: billing?.charged_usd ?? null,
        balanceAfterUsd: billing?.balance_after_usd ?? null,
        durationMs,
        success: false,
        errorCode: code,
      });
      this.logger.warn(
        `[everyinfra] ${platform}/${action} 业务错误 code=${code} http=${httpStatus} req=${requestId ?? '-'} ${businessError}`,
      );
      throw new EveryInfraError(
        code,
        `EveryInfra ${platform}/${action} 业务错误：${businessError}`,
        {
          httpStatus,
          requestId,
          billing,
          details: requestId ? `req=${requestId}` : undefined,
        },
      );
    }

    const items = extractItems(body);
    const count = extractCount(body);

    // 响应必须与请求的 platform/action 一致，避免把错误平台的数据当成结果。
    const responsePlatform =
      typeof body['platform'] === 'string' ? body['platform'] : null;
    const responseAction =
      typeof body['action'] === 'string' ? body['action'] : null;
    if (
      (responsePlatform && responsePlatform !== platform) ||
      (responseAction && responseAction !== action)
    ) {
      const mismatch = `响应 platform/action 与请求不一致：请求 ${platform}/${action}，响应 ${
        responsePlatform ?? '-'
      }/${responseAction ?? '-'}`;
      this.usage.record({
        at: new Date().toISOString(),
        platform,
        action,
        requestId,
        httpStatus,
        chargedUsd: billing?.charged_usd ?? null,
        balanceAfterUsd: billing?.balance_after_usd ?? null,
        durationMs,
        success: false,
        errorCode: ProviderErrorCodeEnum.EVERYINFRA_BAD_RESPONSE,
      });
      this.logger.warn(
        `[everyinfra] ${mismatch} req=${requestId ?? '-'}`,
      );
      throw new EveryInfraError(
        ProviderErrorCodeEnum.EVERYINFRA_BAD_RESPONSE,
        `EveryInfra ${mismatch}`,
        { httpStatus, requestId, billing },
      );
    }

    this.usage.record({
      at: new Date().toISOString(),
      platform,
      action,
      requestId,
      httpStatus,
      chargedUsd: billing?.charged_usd ?? null,
      balanceAfterUsd: billing?.balance_after_usd ?? null,
      durationMs,
      success: true,
      errorCode: null,
    });
    this.logger.log(
      `[everyinfra] ${platform}/${action} http=${httpStatus} items=${items.length} charged=${
        billing?.charged_usd ?? 'unknown'
      } req=${requestId ?? '-'} ${durationMs}ms`,
    );

    return {
      platform,
      action,
      items,
      count,
      billing,
      requestId,
      raw: body,
    };
  }
}
