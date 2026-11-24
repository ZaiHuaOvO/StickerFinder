/* eslint-disable no-console */
/**
 * 在数据集额度有效期内采集真实搜索/详情响应，保存为离线 fixtures。
 * 只调用 EveryInfra，不写数据库；按累计费用自动停止。
 * 用法：cd backend && node scripts/collect-fixtures.js
 */
const fs = require('fs');
const path = require('path');
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
  TaobaoEveryInfraProvider,
} = require('../dist/providers/taobao/taobao-everyinfra.provider');
const {
  DouyinEveryInfraProvider,
} = require('../dist/providers/douyin/douyin-everyinfra.provider');
const {
  XiaohongshuEveryInfraProvider,
} = require('../dist/providers/xiaohongshu/xiaohongshu-everyinfra.provider');
const {
  Alibaba1688EveryInfraProvider,
} = require('../dist/providers/alibaba1688/alibaba1688-everyinfra.provider');
const {
  sanitizeRawData,
} = require('../dist/common/utils/sanitize.util');

const BUDGET_USD = Number(process.env.COLLECT_BUDGET_USD || 0.3);
const OUT_DIR = path.resolve(process.cwd(), 'test/fixtures/raw');
const STICKERS = [
  { id: 'sticker-01', target: '菜食场', series: '利胜 15.0' },
  { id: 'sticker-02', target: '琉璃盏', series: '天空岛 10.0' },
  { id: 'sticker-03', target: '疯人院', series: '星眠 9.0' },
  { id: 'sticker-04', target: '非实用之家', series: '芋泥小 10.0' },
  { id: 'sticker-05', target: '雅物书房', series: '利胜 15.0' },
];
const DETAIL_LIMITS = {
  taobao: 2,
  alibaba1688: 2,
  douyin: 1,
  xiaohongshu: 1,
};

const config = new EveryInfraConfig(new ConfigService());
const usage = new EveryInfraUsageService();
const client = new EveryInfraClient(config, usage);
const providers = {
  taobao: new TaobaoEveryInfraProvider(client, config),
  alibaba1688: new Alibaba1688EveryInfraProvider(client, config),
  douyin: new DouyinEveryInfraProvider(client, config),
  xiaohongshu: new XiaohongshuEveryInfraProvider(client, config),
};

let spentUsd = 0;

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[　\s]+/g, '');
}

function plainProduct(product) {
  if (!product) return null;
  const plain = JSON.parse(JSON.stringify(product));
  if (plain.rawData) {
    plain.rawData = sanitizeRawData(plain.rawData);
  }
  return plain;
}

function stamp() {
  return new Date().toISOString();
}

async function collectSticker(sticker) {
  console.log(`\n===== ${sticker.id} ${sticker.target} / ${sticker.series} =====`);
  const platforms = {};
  for (const [platform, provider] of Object.entries(providers)) {
    if (spentUsd >= BUDGET_USD) {
      platforms[platform] = { skipped: `budget reached (${spentUsd.toFixed(4)} USD)` };
      continue;
    }
    if (!provider.isConfigured()) {
      platforms[platform] = { skipped: 'not configured' };
      continue;
    }
    const startedAt = stamp();
    try {
      const result = await provider.search(sticker.target, {
        maxResults: 20,
        maxPages: 1,
        requestDelayMs: 0,
      });
      spentUsd += result.usage?.chargedUsd ?? 0;
      const titleMatches = result.products.filter((product) => {
        const title = normalize(product.title);
        return (
          title.includes(normalize(sticker.target)) ||
          title.includes(normalize(sticker.series))
        );
      });
      const limit = DETAIL_LIMITS[platform] ?? 1;
      const details = [];
      for (const product of titleMatches.slice(0, limit)) {
        if (spentUsd >= BUDGET_USD) break;
        try {
          const detail = await provider.fetchDetail(product);
          spentUsd += detail.usage?.chargedUsd ?? 0;
          details.push({
            sourceProductId: product.platformProductId ?? null,
            warnings: detail.warnings ?? [],
            product: plainProduct(detail.product),
          });
          console.log(
            `  [${platform}] detail ${product.platformProductId ?? '-'} ${
              detail.product ? 'ok' : 'empty'
            } total=${spentUsd.toFixed(4)}`,
          );
        } catch (error) {
          details.push({
            sourceProductId: product.platformProductId ?? null,
            error: error.code || error.message,
          });
          console.log(`  [${platform}] detail error: ${error.code || error.message}`);
        }
      }
      platforms[platform] = {
        startedAt,
        status: result.status,
        warnings: result.warnings ?? [],
        usage: result.usage ?? null,
        parsedCount: result.products.length,
        titleMatchCount: titleMatches.length,
        products: result.products.map(plainProduct),
        details,
      };
      console.log(
        `  [${platform}] search ok items=${result.products.length} titleMatch=${titleMatches.length} details=${details.length} total=${spentUsd.toFixed(4)}`,
      );
    } catch (error) {
      platforms[platform] = {
        startedAt,
        error: error.code || error.message,
      };
      console.log(`  [${platform}] search error: ${error.code || error.message}`);
      if (/INSUFFICIENT_BALANCE|余额/.test(String(error.code || error.message))) {
        console.log('  balance exhausted, stopping collection');
        spentUsd = BUDGET_USD;
      }
    }
  }

  const payload = {
    id: sticker.id,
    targetName: sticker.target,
    seriesName: sticker.series,
    collectedAt: stamp(),
    source: 'EveryInfra live capture',
    platforms,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${sticker.id}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`saved ${file}`);
  return payload;
}

async function main() {
  const startedAt = stamp();
  const results = [];
  for (const sticker of STICKERS) {
    if (spentUsd >= BUDGET_USD) break;
    results.push(await collectSticker(sticker));
  }
  const manifest = {
    collectedAt: startedAt,
    finishedAt: stamp(),
    budgetUsd: BUDGET_USD,
    spentUsd: Math.round(spentUsd * 1e6) / 1e6,
    stickers: results.map((result) => ({
      id: result.id,
      targetName: result.targetName,
      seriesName: result.seriesName,
      platforms: Object.fromEntries(
        Object.entries(result.platforms).map(([platform, value]) => [
          platform,
          value.error
            ? { error: value.error }
            : value.skipped
              ? { skipped: value.skipped }
              : {
                  status: value.status,
                  parsedCount: value.parsedCount,
                  titleMatchCount: value.titleMatchCount,
                  detailCount: value.details.length,
                },
        ]),
      ),
    })),
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  console.log('\nDONE', JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error('collect failed:', error);
  process.exit(1);
});
