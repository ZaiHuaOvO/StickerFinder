/* eslint-disable no-console */
/**
 * 真实接口字段核对工具：只打印商品响应中的价格/优惠相关字段，不打印任何密钥。
 * 用法：cd backend && npm run promotions:inspect
 * 会产生少量 EveryInfra 调用费用（淘宝搜索+详情、1688 搜索+详情）。
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '../.env') });

const { ConfigService } = require('@nestjs/config');
const {
  EveryInfraConfig,
} = require('../dist/providers/everyinfra/everyinfra.config');
const {
  EveryInfraClient,
} = require('../dist/providers/everyinfra/everyinfra.client');
const {
  EveryInfraUsageService,
} = require('../dist/providers/everyinfra/everyinfra.usage.service');
const {
  mapTaobaoProduct,
  mapTaobaoDetail,
} = require('../dist/providers/everyinfra/mappers/taobao.mapper');
const {
  mapAlibaba1688Product,
  mapAlibaba1688Detail,
} = require('../dist/providers/everyinfra/mappers/alibaba1688.mapper');
const {
  sanitizeRawData,
} = require('../dist/common/utils/sanitize.util');

const config = new EveryInfraConfig(new ConfigService());
const usage = new EveryInfraUsageService();
const client = new EveryInfraClient(config, usage);

const KEY_PATTERN = /price|coupon|promotion|discount|tier|sku|stock|unit|quantity/i;

function relevantFields(record) {
  const result = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KEY_PATTERN.test(key)) continue;
    if (key === 'promotions' || key === 'promotion_details') {
      result[key] = Array.isArray(value) ? value.slice(0, 5) : value;
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 3).map((item) =>
        item && typeof item === 'object' ? Object.keys(item) : typeof item,
      );
      continue;
    }
    result[key] = typeof value === 'object' && value ? '[object]' : value;
  }
  return result;
}

function summarize(product) {
  if (!product) return null;
  return {
    price: product.price?.amount ?? null,
    couponPrice: product.couponPrice?.amount ?? null,
    skuCount: product.skuOptions?.length ?? 0,
    skuCouponPrices: (product.skuOptions ?? [])
      .filter((sku) => sku.couponPrice !== undefined)
      .slice(0, 5),
    promotions: product.promotions ?? [],
  };
}

async function inspect(platform, searchKeyword, mapSearch, mapDetail) {
  console.log(`\n=== ${platform} search ===`);
  const searchAction = 'search';
  const searchParams =
    platform === 'taobao'
      ? { keyword: searchKeyword, page: 1, limit: 5, sort: 'relevance' }
      : { keyword: searchKeyword, sort: 'relevance' };
  const search = await client.call(platform, searchAction, searchParams);
  const first = search.items[0];
  if (!first) {
    console.log('no items returned');
    return;
  }
  console.log('item keys:', Object.keys(first).join(', '));
  console.log('relevant:', JSON.stringify(relevantFields(first), null, 2));
  const mappedSearch = mapSearch(first);
  console.log('mapped search:', JSON.stringify(summarize(mappedSearch), null, 2));

  console.log(`\n=== ${platform} product_detail ===`);
  const urlOrId = mappedSearch?.productUrl || mappedSearch?.platformProductId;
  if (!urlOrId) {
    console.log('no detail target');
    return;
  }
  const detail = await client.call(platform, 'product_detail', {
    url: urlOrId,
  });
  const detailItem = detail.items[0];
  if (!detailItem) {
    console.log('detail returned no items');
    return;
  }
  console.log('detail keys:', Object.keys(detailItem).join(', '));
  console.log('relevant:', JSON.stringify(relevantFields(detailItem), null, 2));
  const mappedDetail = mapDetail(detailItem, mappedSearch);
  console.log('mapped detail:', JSON.stringify(summarize(mappedDetail), null, 2));
  console.log(
    'detail raw (sanitized, first 1500 chars):',
    JSON.stringify(sanitizeRawData(detailItem)).slice(0, 1500),
  );
}

async function main() {
  const only = process.env.INSPECT_PLATFORM;
  const keyword = process.argv[2] || '造景贴纸';
  if (only !== 'alibaba1688') {
    if (!config.isAvailable('taobao')) {
      console.log('EveryInfra taobao 未配置，跳过');
    } else {
      await inspect('taobao', keyword, mapTaobaoProduct, mapTaobaoDetail);
    }
  }
  if (only !== 'taobao') {
    if (!config.isAvailable('alibaba1688')) {
      console.log('EveryInfra alibaba1688 未配置，跳过');
    } else {
      await inspect(
        'alibaba1688',
        process.argv[3] || keyword,
        mapAlibaba1688Product,
        mapAlibaba1688Detail,
      );
    }
  }
  console.log('\nusage:', JSON.stringify(usage.summary(), null, 2));
}

main().catch((error) => {
  console.error('inspect failed:', error.message);
  process.exit(1);
});
