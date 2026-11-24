import { ProviderError } from '../../common/errors/provider.errors';
import { ProviderErrorCodeEnum } from '../../common/enums';
import { EveryInfraBilling } from './everyinfra.types';

export class EveryInfraError extends ProviderError {
  constructor(
    code: string,
    message: string,
    readonly options: {
      details?: string;
      httpStatus?: number;
      requestId?: string | null;
      serviceCode?: string | null;
      billing?: EveryInfraBilling | null;
    } = {},
  ) {
    super(code, message, options.details);
    this.name = 'EveryInfraError';
  }
}

const INSUFFICIENT_BALANCE_PATTERN =
  /(insufficient|balance|quota|credit|payment required|余额|额度|欠费|不足)/i;
const AUTH_PATTERN = /(unauthori[sz]ed|forbidden|invalid token|invalid api key|认证|密钥)/i;

/**
 * 把 HTTP 状态/服务商错误统一映射为稳定错误码。
 * 不在这里重试：余额不足、认证失败与明确拒绝只请求一次。
 */
export function classifyEveryInfraError(
  status: number | undefined,
  message: string,
): string {
  if (status === 401 || status === 403) {
    return ProviderErrorCodeEnum.EVERYINFRA_AUTH_ERROR;
  }
  if (status === 402 || INSUFFICIENT_BALANCE_PATTERN.test(message)) {
    return ProviderErrorCodeEnum.EVERYINFRA_INSUFFICIENT_BALANCE;
  }
  if (status === 429) {
    return ProviderErrorCodeEnum.EVERYINFRA_RATE_LIMITED;
  }
  if (status === 408 || /timeout|timed out|ETIMEDOUT/i.test(message)) {
    return ProviderErrorCodeEnum.EVERYINFRA_TIMEOUT;
  }
  if (AUTH_PATTERN.test(message)) {
    return ProviderErrorCodeEnum.EVERYINFRA_AUTH_ERROR;
  }
  return ProviderErrorCodeEnum.EVERYINFRA_API_ERROR;
}
