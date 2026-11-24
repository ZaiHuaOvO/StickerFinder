import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  PlatformEnum,
  PriceTypeEnum,
  ProviderErrorCodeEnum,
  ProviderKeyEnum,
} from '../src/common/enums';
import { NotConfiguredError } from '../src/common/errors/provider.errors';
import { mergeWholesale } from '../src/common/utils/wholesale.util';
import { Alibaba1688EveryInfraProvider } from '../src/providers/alibaba1688/alibaba1688-everyinfra.provider';
import { DouyinEveryInfraProvider } from '../src/providers/douyin/douyin-everyinfra.provider';
import { EveryInfraClient } from '../src/providers/everyinfra/everyinfra.client';
import { EveryInfraConfig } from '../src/providers/everyinfra/everyinfra.config';
import { EveryInfraError } from '../src/providers/everyinfra/everyinfra-error';
import { EveryInfraUsageService } from '../src/providers/everyinfra/everyinfra.usage.service';
import {
  mapAlibaba1688Detail,
  mapAlibaba1688ImageSearchItem,
  mapAlibaba1688Product,
  parsePriceTiers,
} from '../src/providers/everyinfra/mappers/alibaba1688.mapper';
import {
  mapDouyinDetail,
  mapDouyinProduct,
} from '../src/providers/everyinfra/mappers/douyin.mapper';
import {
  mapTaobaoDetail,
  mapTaobaoProduct,
} from '../src/providers/everyinfra/mappers/taobao.mapper';
import {
  mapXiaohongshuDetail,
  mapXiaohongshuProduct,
} from '../src/providers/everyinfra/mappers/xiaohongshu.mapper';
import { TaobaoEveryInfraProvider } from '../src/providers/taobao/taobao-everyinfra.provider';

type AxiosPost = typeof axios.post;
const axiosMutable = axios as unknown as { post: AxiosPost };
const originalPost = axiosMutable.post;

function mockAxiosPost(
  handler: (url: string, body: unknown, config: unknown) => unknown,
): { calls: number } {
  const state = { calls: 0 };
  axiosMutable.post = ((async (
    url: string,
    body: unknown,
    config: unknown,
  ) => {
    state.calls += 1;
    return handler(url, body, config);
  }) as unknown) as AxiosPost;
  return state;
}

function configService(extra: Record<string, string> = {}): ConfigService {
  return new ConfigService({
    EVERYINFRA_API_KEY: 'test-key',
    EVERYINFRA_BASE_URL: 'https://api.example.test',
    SEARCH_DATA_MODE: 'live',
    LIVE_PROVIDER_REQUESTS_ENABLED: 'true',
    ...extra,
  });
}

function clientWith(extra: Record<string, string> = {}) {
  const config = new EveryInfraConfig(configService(extra));
  const usage = new EveryInfraUsageService();
  return { config, usage, client: new EveryInfraClient(config, usage) };
}

afterEach(() => {
  axiosMutable.post = originalPost;
});

describe('EveryInfra client (mocked HTTP, not a real API test)', () => {
  it('posts the unified payload with Bearer auth and reads items/billing/request id', async () => {
    const captured: {
      value: {
        url: string;
        body: Record<string, unknown>;
        config: { headers?: Record<string, string> };
      } | null;
    } = { value: null };
    mockAxiosPost((url, body, config) => {
      captured.value = {
        url,
        body: body as Record<string, unknown>,
        config: config as { headers?: Record<string, string> },
      };
      return {
        status: 200,
        headers: { 'x-request-id': 'req-header-1' },
        data: {
          platform: 'taobao',
          action: 'search',
          results: [{ item_id: '1', title: '贴纸' }],
          billing: { charged: true, charged_usd: 0.0135, balance_after_usd: 9.9 },
        },
      };
    });

    const { client, usage } = clientWith();
    const result = await client.call('taobao', 'search', { keyword: '贴纸' });

    assert.ok(captured.value);
    assert.equal(captured.value.url, 'https://api.example.test/api/v1/social');
    assert.equal(captured.value.body.platform, 'taobao');
    assert.equal(captured.value.body.action, 'search');
    assert.deepEqual(captured.value.body.params, { keyword: '贴纸' });
    assert.equal(
      captured.value.config.headers?.Authorization,
      'Bearer test-key',
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.billing?.charged_usd, 0.0135);
    assert.equal(result.requestId, 'req-header-1');

    const summary = usage.summary();
    assert.equal(summary.totalCalls, 1);
    assert.equal(summary.totalChargedUsd, 0.0135);
  });

  it('wraps a single detail object returned directly in results (real API shape)', async () => {
    mockAxiosPost(() => ({
      status: 200,
      headers: {},
      data: {
        id: 'req_detail_object',
        platform: 'taobao',
        action: 'product_detail',
        results: {
          id: '1043021595275',
          title: '真实详情商品',
          url: 'https://item.taobao.com/item.htm?id=1043021595275',
        },
        billing: { charged: true, charged_usd: 0.0045 },
      },
    }));
    const { client } = clientWith();
    const result = await client.call('taobao', 'product_detail', {
      url: 'https://item.taobao.com/item.htm?id=1043021595275',
    });
    assert.equal(result.items.length, 1);
    assert.equal(
      (result.items[0] as { title: string }).title,
      '真实详情商品',
    );
    assert.equal(result.requestId, 'req_detail_object');
  });

  it('wraps a single detail object and does not require results to be an array', async () => {
    mockAxiosPost(() => ({
      status: 200,
      headers: {},
      data: {
        platform: 'alibaba1688',
        action: 'product_detail',
        data: { id: '123', title: '造景贴纸', price_min: 0.5, currency: 'CNY' },
      },
    }));
    const { client } = clientWith();
    const result = await client.call('alibaba1688', 'product_detail', {
      url: 'https://detail.1688.com/offer/123.html',
    });
    assert.equal(result.items.length, 1);
    assert.equal((result.items[0] as { title: string }).title, '造景贴纸');
  });

  it('reads the request id from the response id when no header is present', async () => {
    mockAxiosPost(() => ({
      status: 200,
      headers: {},
      data: {
        id: 'req_mock_body_1',
        platform: 'taobao',
        action: 'search',
        results: [],
        count: 0,
      },
    }));
    const { client } = clientWith();
    const result = await client.call('taobao', 'search', { keyword: 'x' });
    assert.equal(result.requestId, 'req_mock_body_1');
  });

  it('rejects a response whose platform/action does not match the request', async () => {
    mockAxiosPost(() => ({
      status: 200,
      headers: {},
      data: {
        id: 'req_mismatch',
        platform: 'douyin',
        action: 'product_search',
        results: [{ product_id: '1', title: 'x', url: 'https://example.com/1' }],
      },
    }));
    const { client } = clientWith();
    await assert.rejects(
      () => client.call('taobao', 'search', { keyword: 'x' }),
      (error: unknown) => {
        assert.ok(error instanceof EveryInfraError);
        assert.equal(
          error.code,
          ProviderErrorCodeEnum.EVERYINFRA_BAD_RESPONSE,
        );
        return true;
      },
    );
  });

  it('classifies business errors such as insufficient balance and does not retry', async () => {
    const state = mockAxiosPost(() => ({
      status: 200,
      headers: { 'x-request-id': 'req-balance' },
      data: { success: false, message: 'insufficient balance', request_id: 'req-body' },
    }));
    const { client } = clientWith();
    await assert.rejects(
      () => client.call('douyin', 'product_search', { keyword: '贴纸' }),
      (error: unknown) => {
        assert.ok(error instanceof EveryInfraError);
        assert.equal(
          error.code,
          ProviderErrorCodeEnum.EVERYINFRA_INSUFFICIENT_BALANCE,
        );
        return true;
      },
    );
    assert.equal(state.calls, 1);
  });

  it('maps HTTP 401 to auth error and records the failed call', async () => {
    mockAxiosPost(() =>
      Promise.reject({
        isAxiosError: true,
        message: 'Request failed with status code 401',
        response: {
          status: 401,
          data: { error: 'invalid api key' },
          headers: { 'x-request-id': 'req-auth' },
        },
      }),
    );
    const { client, usage } = clientWith();
    await assert.rejects(
      () => client.call('xiaohongshu', 'product_search', { keyword: '贴纸' }),
      (error: unknown) => {
        assert.ok(error instanceof EveryInfraError);
        assert.equal(error.code, ProviderErrorCodeEnum.EVERYINFRA_AUTH_ERROR);
        return true;
      },
    );
    assert.equal(usage.summary().failedCalls, 1);
  });

  it('returns NOT_CONFIGURED when EVERYINFRA_API_KEY is empty', async () => {
    const config = new EveryInfraConfig(configService({ EVERYINFRA_API_KEY: '' }));
    const client = new EveryInfraClient(config, new EveryInfraUsageService());
    assert.equal(client.isConfigured('taobao'), false);
    await assert.rejects(
      () => client.call('taobao', 'search', { keyword: 'x' }),
      NotConfiguredError,
    );
  });
});

describe('EveryInfra config limits', () => {
  it('defaults to a single page and clamps detail enrichment to 10', () => {
    const config = new EveryInfraConfig(
      configService({
        EVERYINFRA_DETAIL_MAX_PER_PLATFORM: '99',
        EVERYINFRA_DETAIL_CONCURRENCY: '99',
      }),
    );
    assert.equal(config.maxPages('taobao'), 1);
    assert.equal(config.maxPages('xiaohongshu'), 1);
    assert.equal(config.maxResults('taobao'), 20);
    assert.equal(config.maxResults('alibaba1688'), 20);
    assert.equal(config.detailMaxPerPlatform, 10);
    assert.equal(config.detailConcurrency, 5);
    assert.equal(config.imageSearchEnabled, false);
  });

  it('defaults detail concurrency to 2 and limit to 10', () => {
    const config = new EveryInfraConfig(configService({}));
    assert.equal(config.detailMaxPerPlatform, 10);
    assert.equal(config.detailConcurrency, 2);
  });

  it('uses a longer timeout for 1688 search', () => {
    const config = new EveryInfraConfig(configService({}));
    assert.equal(config.timeoutMsFor('taobao'), 30000);
    assert.equal(config.timeoutMsFor('alibaba1688'), 60000);

    const custom = new EveryInfraConfig(
      configService({ EVERYINFRA_1688_TIMEOUT_MS: '75000' }),
    );
    assert.equal(custom.timeoutMsFor('alibaba1688'), 75000);
  });

  it('reports disabled platforms without calling them', () => {
    const config = new EveryInfraConfig(
      configService({ EVERYINFRA_TAOBAO_ENABLED: 'false' }),
    );
    assert.equal(config.isAvailable('taobao'), false);
    assert.match(config.unavailableReason('taobao') ?? '', /EVERYINFRA_TAOBAO_ENABLED/);
    assert.equal(config.isAvailable('douyin'), true);
  });
});

describe('EveryInfra provider (mocked HTTP, not a real API test)', () => {
  it('Taobao search returns normalized products and usage stats', async () => {
    mockAxiosPost(() => ({
      status: 200,
      headers: {},
      data: {
        results: [
          {
            item_id: '888',
            title: '米饼4.0系列 造景贴纸',
            url: 'https://item.taobao.com/item.htm?id=888',
            shop_name: '示例文具店',
            price: '12.50',
            original_price: '19.90',
            images: ['//img.alicdn.com/a.jpg'],
            skus: [{ sku_id: 's1', name: '单款', price: '12.50' }],
            price_basis: 'page',
          },
        ],
        billing: { charged: true, charged_usd: 0.0135 },
        request_id: 'req-taobao-1',
      },
    }));
    const { client, config } = clientWith();
    const provider = new TaobaoEveryInfraProvider(client, config);
    const result = await provider.search('造景贴纸', {
      maxResults: 20,
      maxPages: 1,
      requestDelayMs: 0,
    });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.products.length, 1);
    const product = result.products[0];
    assert.equal(product.providerKey, ProviderKeyEnum.EVERYINFRA_TAOBAO);
    assert.equal(product.price?.amount, 12.5);
    assert.equal(product.price?.originalAmount, 19.9);
    assert.match(product.price?.note ?? '', /页面现价/);
    assert.equal(product.imageUrls[0], 'https://img.alicdn.com/a.jpg');
    assert.equal(product.sourceKeyword, '造景贴纸');
    assert.equal(result.usage?.apiRequestCount, 1);
    assert.equal(result.usage?.chargedUsd, 0.0135);
    assert.deepEqual(result.usage?.requestIds, ['req-taobao-1']);
  });

  it('Taobao returns NOT_CONFIGURED without an API key', async () => {    const { config } = clientWith({ EVERYINFRA_API_KEY: '' });
    const provider = new TaobaoEveryInfraProvider(
      new EveryInfraClient(config, new EveryInfraUsageService()),
      config,
    );
    assert.equal(provider.isConfigured(), false);
    await assert.rejects(
      () =>
        provider.search('x', {
          maxResults: 20,
          maxPages: 1,
          requestDelayMs: 0,
        }),
      NotConfiguredError,
    );
  });

  it('Douyin ingests all items actually returned (30), not the generic 20 cap', async () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      product_id: `product-${index + 1}`,
      promotion_id: `promotion-${index + 1}`,
      title: `造景贴纸 ${index + 1}`,
      url: `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${index + 1}`,
      price_cny: 9.9,
      price_label: '到手价',
    }));
    mockAxiosPost(() => ({
      status: 200,
      headers: {},
      data: {
        id: 'req_douyin_30',
        platform: 'douyin',
        action: 'product_search',
        results: items,
        count: 30,
        billing: { charged: true, charged_usd: 0.008 },
      },
    }));
    const { client, config } = clientWith();
    const provider = new DouyinEveryInfraProvider(client, config);
    const result = await provider.search('造景贴纸', {
      maxResults: 20,
      maxPages: 1,
      requestDelayMs: 0,
    });
    assert.equal(result.products.length, 30);
    assert.equal(result.usage?.apiRequestCount, 1);
    assert.equal(result.usage?.chargedUsd, 0.008);
  });

  it('1688 image search caps at 5 candidates and records documented usage when enabled', async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `offer-${index + 1}`,
      url: `https://detail.1688.com/offer/offer-${index + 1}.html`,
      title: `图搜候选 ${index + 1}`,
      price: 1.2 + index,
      currency: 'CNY',
      min_order_quantity: 10,
      order_count: 100,
      supplier_name: '示例供应商',
      image_url: 'https://img.example.com/ref.jpg',
      rank: index + 1,
    }));
    const sent: { value: Record<string, unknown> | null } = { value: null };
    mockAxiosPost((_url, body) => {
      sent.value = body as Record<string, unknown>;
      return {
        status: 200,
        headers: {},
        data: {
          id: 'req_image_search',
          platform: 'alibaba1688',
          action: 'image_search',
          results: items,
          count: 6,
          billing: { charged: true, charged_usd: 0.005556 },
        },
      };
    });
    const { client, config } = clientWith({
      EVERYINFRA_1688_IMAGE_SEARCH_ENABLED: 'true',
    });
    const provider = new Alibaba1688EveryInfraProvider(client, config);
    const result = await provider.searchByImage('https://example.com/ref.jpg');
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.products.length, 5);
    assert.equal(result.usage?.apiRequestCount, 1);
    assert.equal(result.usage?.chargedUsd, 0.005556);
    assert.deepEqual(result.usage?.requestIds, ['req_image_search']);
    assert.ok(sent.value);
    assert.equal(sent.value.action, 'image_search');
    assert.deepEqual(sent.value.params, {
      image_url: 'https://example.com/ref.jpg',
    });
    assert.match(result.warnings?.join(' ') ?? '', /rank 只表示本次结果顺序/);
  });

  it('1688 image search is disabled by default and never calls the API', async () => {    const state = mockAxiosPost(() => {
      throw new Error('must not be called');
    });
    const { client, config } = clientWith();
    const provider = new Alibaba1688EveryInfraProvider(client, config);
    await assert.rejects(
      () => provider.searchByImage('https://cdn.example.com/a.jpg'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          (error as { code?: string }).code,
          ProviderErrorCodeEnum.EVERYINFRA_IMAGE_SEARCH_DISABLED,
        );
        return true;
      },
    );
    assert.equal(state.calls, 0);
  });
});

describe('EveryInfra mappers', () => {
  it('maps Taobao price basis, SKU and raw coupon data without deducting coupons', () => {
    const product = mapTaobaoProduct({
      item_id: 123,
      title: 'A系列 B贴纸',
      url: 'https://item.taobao.com/item.htm?id=123',
      price: '9.90',
      coupon_amount: '2',
      location: '浙江 杭州',
      image_url: 'https://img.alicdn.com/real.jpg',
      original_price: '9.90',
      skus: [{ sku_id: 'a', name: 'B款', price: '9.90' }],
    });
    assert.ok(product);
    assert.equal(product.platform, PlatformEnum.TAOBAO);
    assert.equal(product.platformProductId, '123');
    assert.equal(product.region, '浙江 杭州');
    assert.equal(product.imageUrls[0], 'https://img.alicdn.com/real.jpg');
    assert.equal(product.price?.originalAmount, undefined);
    assert.equal(product.originalPrice, null);
    assert.equal(product.price?.amount, 9.9);
    assert.equal(product.price?.priceSource, 'everyinfra_taobao');
    assert.equal(product.skuOptions[0]?.price, 9.9);
    assert.equal(product.rawData?.coupon_amount, '2');
  });

  it('keeps Douyin price_cny and price_label together and promotion_id separate', () => {
    const product = mapDouyinProduct({
      product_id: '3633772266610903778',
      promotion_id: '3641755479459406882',
      title: '米之莲口红',
      url: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1',
      price_cny: 29.9,
      price_label: '到手价',
      monthly_sales: 1234,
      good_review_ratio: 96.5,
      shop_name: '喵妮美妆严选',
    });
    assert.ok(product);
    assert.equal(product.platformProductId, '3633772266610903778');
    assert.equal(product.price?.amount, 29.9);
    assert.match(product.price?.note ?? '', /到手价/);
    assert.equal(product.salesText, '近30天销量 1234');
    assert.equal(product.rating, 96.5);
    assert.equal(
      product.rawData?.promotion_id,
      '3641755479459406882',
    );
  });

  it('rejects Xiaohongshu notes and does not assume CNY when currency is null', () => {
    assert.equal(
      mapXiaohongshuProduct({
        note_id: 'note-1',
        title: '贴纸分享笔记',
        url: 'https://www.xiaohongshu.com/explore/note-1',
      }),
      null,
    );
    const product = mapXiaohongshuProduct({
      product_id: '24charproductid000000001',
      title: '造景贴纸 单款',
      url: 'https://www.xiaohongshu.com/goods-detail/24charproductid000000001',
      price: 5.5,
      currency: null,
      sold_count: 88,
      in_stock: true,
    });
    assert.ok(product);
    assert.equal(product.price?.currency, 'UNKNOWN');
    assert.match(product.price?.displayText ?? '', /币种未知/);
    assert.equal(product.price?.priceType, PriceTypeEnum.LOWEST_SKU);
    assert.equal(product.salesText, '销量 88');
    assert.match(product.price?.note ?? '', /有货/);
  });

  it('stores 1688 wholesale price separately and never fills retail price', () => {
    const product = mapAlibaba1688Product({
      id: 'offer-1',
      title: '米饼4.0系列造景贴纸',
      url: 'https://detail.1688.com/offer/offer-1.html',
      price_min: 0.5,
      price_max: 1.2,
      currency: 'CNY',
      unit: '件',
      min_order_quantity: 100,
      supplier_name: '义乌示例供应商',
      images: ['https://img.example.com/1.jpg'],
      price_tiers: [
        { min_quantity: 1000, price: 0.5 },
        { min_quantity: 100, price: 1.2 },
        { min_quantity: 500, price: 0.8 },
      ],
      specs: [{ name: '款式', value: '米饼4.0' }],
    });
    assert.ok(product);
    assert.equal(product.platform, PlatformEnum.ALIBABA1688);
    assert.equal(product.price, undefined);
    assert.equal(product.shopName, '义乌示例供应商');
    assert.deepEqual(
      product.wholesalePrice?.priceTiers.map((tier) => tier.minQuantity),
      [100, 500, 1000],
    );
    assert.equal(product.wholesalePrice?.minOrderQuantity, 100);
    assert.equal(product.wholesalePrice?.unit, '件');
    assert.equal(product.wholesalePrice?.currency, 'CNY');
    assert.equal(product.skuOptions[0]?.name, '款式：米饼4.0');
  });

  it('keeps unknown 1688 currency, MOQ and tiers as null instead of guessing', () => {
    const product = mapAlibaba1688Product({
      id: 'offer-2',
      title: '未知条件商品',
      url: 'https://detail.1688.com/offer/offer-2.html',
      price_min: 3.5,
    });
    assert.ok(product);
    assert.equal(product.wholesalePrice?.currency, null);
    assert.equal(product.wholesalePrice?.minOrderQuantity, null);
    assert.deepEqual(product.wholesalePrice?.priceTiers, []);
  });

  it('ignores malformed price tiers and marks image search rank as non-sales rank', () => {
    assert.deepEqual(
      parsePriceTiers([{ price: 'x' }, { min_quantity: 0, price: 1 }]),
      [],
    );
    const product = mapAlibaba1688ImageSearchItem({
      id: 'offer-3',
      title: '相似货源',
      url: 'https://detail.1688.com/offer/offer-3.html',
      price: 0.8,
      currency: 'CNY',
      min_order_quantity: 50,
      supplier_name: '示例供应商',
      rank: 2,
    });
    assert.ok(product);
    assert.match(product.wholesalePrice?.note ?? '', /不代表销量排名/);
    assert.equal(product.wholesalePrice?.minOrderQuantity, 50);
  });
});

describe('wholesale merge rules', () => {
  const base = {
    priceMin: 16.8,
    priceMax: null,
    currency: 'CNY',
    unit: null,
    minOrderQuantity: null,
    priceTiers: [],
    note: '搜索条件',
  };
  const detail = {
    priceMin: 14.4,
    priceMax: 18.8,
    currency: 'CNY',
    unit: '件',
    minOrderQuantity: 1,
    priceTiers: [],
    note: '详情条件',
  };

  it('replaces an incomplete search range with the complete detail range', () => {
    const merged = mergeWholesale(base, detail);
    assert.equal(merged.priceMin, 14.4);
    assert.equal(merged.priceMax, 18.8);
    assert.equal(merged.unit, '件');
    assert.equal(merged.note, '详情条件');
  });

  it('never mixes priceMin from one request with priceMax from another', () => {
    const existing = { ...base, priceMin: 10, priceMax: 20, note: 'existing' };
    const incoming = { ...detail, priceMin: 12, priceMax: 18, note: 'incoming' };
    const merged = mergeWholesale(existing, incoming);
    assert.equal(merged.priceMin, 10);
    assert.equal(merged.priceMax, 20);
    assert.equal(merged.note, 'existing');
  });
});

describe('EveryInfra detail mappers (real-shaped fixtures)', () => {
  it('maps 1688 detail SKUs, MOQ and mix wholesale without inventing tiers', () => {
    const base = mapAlibaba1688Product({
      id: '1038894774016',
      title: '提拉多微缩场景合集本9.0造景贴纸',
      url: 'https://detail.1688.com/offer/1038894774016.html',
    });
    assert.ok(base);
    const product = mapAlibaba1688Detail(
      {
        id: '1038894774016',
        url: 'https://detail.1688.com/offer/1038894774016.html',
        title: '提拉多微缩场景合集本9.0造景贴纸',
        text: '硬壳封面',
        price_min: 14.4,
        price_max: 18.8,
        currency: 'CNY',
        unit: '件',
        min_order_quantity: 1,
        stock: 19596,
        sold_count: 50333,
        supplier_name: 'telado/提拉多品牌专营店',
        supports_dropship: true,
        skus: [
          {
            id: 's1',
            name: '微缩场景合集本8.0',
            price: 14.4,
            image_url: 'https://img.example.com/sku.jpg',
          },
        ],
        specs: [{ name: '材质', value: 'pet' }],
        mix_wholesale: { min_amount: 99, min_varieties: 1 },
        shipping: { fee: 3, is_free_shipping: false, dispatch_text: '预计10小时发货' },
        images: ['https://img.example.com/1.jpg'],
        description_images: ['https://img.example.com/2.jpg'],
      },
      base,
    );
    assert.ok(product);
    assert.equal(product.price, undefined);
    assert.equal(product.wholesalePrice?.priceMin, 14.4);
    assert.equal(product.wholesalePrice?.priceMax, 18.8);
    assert.equal(product.wholesalePrice?.unit, '件');
    assert.equal(product.wholesalePrice?.minOrderQuantity, 1);
    assert.deepEqual(product.wholesalePrice?.priceTiers, []);
    assert.equal(product.skuOptions[0]?.name, '微缩场景合集本8.0');
    assert.equal(product.skuOptions[0]?.price, 14.4);
    assert.equal(product.salesText, '成交 50333');
    assert.match(product.wholesalePrice?.note ?? '', /库存 19596/);
    assert.match(product.wholesalePrice?.note ?? '', /混批：满 ¥99，1 款起/);
    assert.match(product.wholesalePrice?.note ?? '', /运费 ¥3/);
  });

  it('maps Xiaohongshu detail images, variant name and stock', () => {
    const base = mapXiaohongshuProduct({
      product_id: '69d485738a7da80001e02187',
      title: '妍莜造景贴纸',
      url: 'https://www.xiaohongshu.com/goods-detail/69d485738a7da80001e02187',
      price: 13.9,
      currency: 'CNY',
    });
    assert.ok(base);
    const product = mapXiaohongshuDetail(
      {
        id: '69d485738a7da80001e02187',
        title: '妍莜造景贴纸',
        url: 'https://www.xiaohongshu.com/goods-detail/69d485738a7da80001e02187',
        price: 13.9,
        original_price: 13.9,
        currency: 'CNY',
        in_stock: true,
        sold_count: 27799,
        variant_name: '20.0 霓虹雪夜',
        image_urls: ['https://img.example.com/main.jpg'],
        detail_image_urls: ['https://img.example.com/detail.jpg'],
        shop_name: '妍莜造景贴纸的店',
      },
      base,
    );
    assert.ok(product);
    assert.equal(product.skuOptions[0]?.name, '20.0 霓虹雪夜');
    assert.equal(product.imageUrls.length, 2);
    assert.equal(product.salesText, '销量 27799');
    assert.match(product.price?.note ?? '', /库存状态：有货/);
    assert.equal(product.originalPrice, null);
  });

  it('maps Douyin detail variants, discount note and detail images', () => {
    const base = mapDouyinProduct({
      product_id: '3853438187770871812',
      title: 'Tripaw三脚喵32.0蔓 原创造景贴纸',
      url: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3853438187770871812',
      price_cny: 18.8,
    });
    assert.ok(base);
    const product = mapDouyinDetail(
      {
        product_id: '3853438187770871812',
        title: 'Tripaw三脚喵32.0蔓 原创造景贴纸',
        price_cny: 18.8,
        discount_price_cny: 10.8,
        sales_text: '已售 1.1万',
        sold_count: 11000,
        shop_name: 'TRIPAW三脚喵造景',
        image_url: 'https://img.example.com/main.jpg',
        main_image_urls: ['https://img.example.com/main2.jpg'],
        detail_image_urls: ['https://img.example.com/detail.jpg'],
        shipping_fee_text: '免运费',
        shipping_estimate_text: '48小时内发货',
        on_sale: true,
        variant_groups: [
          {
            name: '款式',
            options: [{ id: '1881563136354331', name: '羽鸢繁花' }],
          },
        ],
      },
      base,
    );
    assert.ok(product);
    assert.equal(product.price?.amount, 18.8);
    assert.match(product.price?.note ?? '', /折扣价字段 10\.80/);
    assert.match(product.price?.note ?? '', /免运费/);
    assert.equal(product.skuOptions[0]?.name, '款式：羽鸢繁花');
    assert.equal(product.skuOptions[0]?.skuId, '1881563136354331');
    assert.equal(product.imageUrls.length, 3);
    assert.equal(product.salesText, '已售 1.1万');
    assert.match(product.productUrl, /3853438187770871812/);
  });

  it('maps Taobao detail shop, SKUs, stock and description images', () => {
    const base = mapTaobaoProduct({
      item_id: '1043021595275',
      title: '森游39.0花园系列造景贴纸',
      url: 'https://item.taobao.com/item.htm?id=1043021595275',
      price: 16.8,
    });
    assert.ok(base);
    const product = mapTaobaoDetail(
      {
        id: '1043021595275',
        url: 'https://item.taobao.com/item.htm?id=1043021595275',
        title: '森游39.0花园系列造景贴纸',
        price: 16.8,
        currency: 'CNY',
        price_basis: 'page',
        stock: 600,
        shop_name: '喵小野贴纸铺',
        skus: [
          {
            id: '6067465965039',
            name: '商品规格:兰花溪-大版',
            price: 16.8,
            stock: 200,
            image_url: 'https://img.example.com/sku.jpg',
          },
        ],
        main_image_url: 'https://img.example.com/main.jpg',
        description_images: ['https://img.example.com/desc.jpg'],
        images: ['https://img.example.com/1.jpg'],
      },
      base,
    );
    assert.ok(product);
    assert.equal(product.shopName, '喵小野贴纸铺');
    assert.equal(product.skuOptions[0]?.name, '商品规格:兰花溪-大版');
    assert.equal(product.skuOptions[0]?.price, 16.8);
    assert.match(product.price?.note ?? '', /页面现价/);
    assert.match(product.price?.note ?? '', /库存 600/);
    assert.equal(product.imageUrls.length, 3);
  });
});
