import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { PlatformEnum } from '../src/common/enums';
import { FixtureService } from '../src/replay/fixture.service';
import { ReplayService } from '../src/replay/replay.service';

let dir = '';
let replay: ReplayService;

const fixture = {
  id: 'demo-01',
  targetName: '小镇一角',
  seriesName: '妍莜21.0',
  collectedAt: '2026-11-24T08:00:00.000Z',
  source: 'test',
  platforms: {
    taobao: {
      status: 'SUCCESS',
      products: [
        {
          platform: 'taobao',
          platformProductId: 'p1',
          title: '妍莜21.0 小镇一角 造景贴纸',
          shopName: '店铺A',
          productUrl: 'https://example.com/p1',
          imageUrls: [],
          skuOptions: [{ skuId: 's1', name: '小镇一角', price: 13.8 }],
          price: {
            amount: 13.8,
            currency: 'CNY',
            displayText: '¥13.80',
            priceType: 'LISTING',
            priceSource: 'test',
            observedAt: '2026-11-24T08:00:00.000Z',
            shippingIncluded: 'unknown',
          },
          sourceType: 'third_party',
          providerKey: 'everyinfra_taobao',
          collectedAt: '2026-11-24T08:00:00.000Z',
          rawData: { title: '妍莜21.0 小镇一角 造景贴纸', coupon_amount: '2' },
        },
        {
          platform: 'taobao',
          platformProductId: 'p2',
          title: '妍莜21.0 山间日落 造景贴纸',
          shopName: '店铺A',
          productUrl: 'https://example.com/p2',
          imageUrls: [],
          skuOptions: [],
          sourceType: 'third_party',
          providerKey: 'everyinfra_taobao',
          collectedAt: '2026-11-24T08:00:00.000Z',
        },
        {
          platform: 'taobao',
          platformProductId: 'p3',
          title: '妍莜21.0 小镇一角 待补详情',
          shopName: '店铺B',
          productUrl: 'https://example.com/p3',
          imageUrls: [],
          skuOptions: [],
          sourceType: 'third_party',
          providerKey: 'everyinfra_taobao',
          collectedAt: '2026-11-24T08:00:00.000Z',
        },
      ],
      details: [
        {
          sourceProductId: 'p1',
          product: {
            platform: 'taobao',
            platformProductId: 'p1',
            title: '妍莜21.0系列 小镇一角 造景贴纸',
            shopName: '店铺A',
            productUrl: 'https://example.com/p1',
            imageUrls: [],
            skuOptions: [{ skuId: 's1', name: '小镇一角', price: 13.8 }],
            price: {
              amount: 13.8,
              currency: 'CNY',
              displayText: '¥13.80',
              priceType: 'LISTING',
              priceSource: 'test',
              observedAt: '2026-11-24T08:00:00.000Z',
              shippingIncluded: 'unknown',
            },
            sourceType: 'third_party',
            providerKey: 'everyinfra_taobao',
            collectedAt: '2026-11-24T08:00:00.000Z',
          },
        },
      ],
    },
  },
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'sticker-fixture-'));
  writeFileSync(join(dir, 'demo-01.json'), JSON.stringify(fixture), 'utf8');
  const fixtures = new FixtureService(
    new ConfigService({ FIXTURE_DIR: dir }),
  );
  replay = new ReplayService(fixtures);
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('offline replay', () => {
  it('lists local fixtures without external calls', () => {
    const result = replay.listFixtures();
    assert.equal(result.externalRequests, 0);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'demo-01');
    assert.equal(result.items[0].platforms[0].productCount, 3);
  });

  it('re-runs the current rule and classifies title/detail/pending results', () => {
    const detail = replay.replay({ fixtureId: 'demo-01' });
    assert.equal(detail.dataSource, 'fixture');
    assert.equal(detail.replay, true);
    assert.equal(detail.searchId, 'replay-demo-01');

    const platform = detail.platforms.find(
      (item) => item.platform === PlatformEnum.TAOBAO,
    );
    assert.ok(platform);
    assert.equal(platform.matchedCount, 1);
    assert.equal(platform.excludedCount, 1);
    assert.equal(platform.uncertainCount, 1);

    const confirmed = platform.products[0];
    assert.equal(confirmed.rule?.status, 'RULE_MATCH_CONFIRMED');
    assert.deepEqual(confirmed.rule?.matchedSkuIds, ['s1']);
    assert.equal(confirmed.manual?.decision, 'PENDING');

    assert.equal(detail.priceSummary.bestPrice?.amount, 13.8);
  });

  it('uses the supplied search criteria instead of the stored ones', () => {
    const detail = replay.replay({
      fixtureId: 'demo-01',
      targetName: '山间日落',
      seriesName: '妍莜21.0',
    });
    const platform = detail.platforms.find(
      (item) => item.platform === PlatformEnum.TAOBAO,
    );
    assert.ok(platform);
    assert.equal(platform.matchedCount, 0);
    assert.equal(platform.excludedCount, 2);
    assert.equal(platform.uncertainCount, 1);
  });

  it('does not read old AI match results', () => {
    const detail = replay.replay({ fixtureId: 'demo-01' });
    const all = detail.platforms.flatMap((item) => [
      ...item.products,
      ...item.uncertainProducts,
      ...item.excludedProducts,
    ]);
    for (const product of all) {
      assert.equal('match' in product, false);
      assert.equal('aiStatus' in (product.rule ?? {}), false);
    }
  });
});
