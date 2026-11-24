import { Injectable } from '@nestjs/common';
import {
  BlockedError,
  GoodsSearchUnavailableError,
  NotConfiguredError,
  ParseFailedError,
} from '../../common/errors/provider.errors';
import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderErrorCodeEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import {
  PlatformProvider,
  ProviderSearchResult,
  ProviderStatus,
  SearchOptions,
} from '../../common/interfaces/provider.interface';
import { nowIso } from '../../common/utils/date.util';
import { toHttpUrl } from '../../common/utils/url.util';
import { BrowserService } from '../../browser/browser.service';
import { Page } from 'playwright';
import { parseVisiblePrice } from '../shared/browser-price';
import {
  XiaohongshuSearchCard,
  buildXiaohongshuSearchUrls,
  classifyXiaohongshuSearch,
  isXiaohongshuGoodsUrl,
} from './xiaohongshu-web';

const LOGIN_HINTS = [
  '登录后查看',
  '登录后',
  '请先登录',
  '请登录',
  '登录注册',
  '扫码登录',
  '手机号登录',
  '立即登录',
];
const NO_RESULT_HINTS = [
  '暂无相关',
  '没有找到相关',
  '未找到相关',
  '暂无搜索',
  '无搜索',
  '暂时没有',
];

interface ScanResult {
  goods: XiaohongshuSearchCard[];
  notes: number;
  goodsModeActive: boolean;
}

type XiaohongshuSearchOutcome =
  | {
      kind: 'goods';
      cards: XiaohongshuSearchCard[];
      noteCount: number;
      goodsModeActive: boolean;
      url: string;
    }
  | { kind: 'empty'; url: string }
  | {
      kind: 'unavailable';
      noteCount: number;
      goodsModeActive: boolean;
      url: string;
      body: string;
      loginRequired: boolean;
    };

@Injectable()
export class XiaohongshuPlaywrightProvider implements PlatformProvider {
  readonly platform = PlatformEnum.XIAOHONGSHU;
  readonly key = ProviderKeyEnum.PLAYWRIGHT;
  readonly providerType = SourceTypeEnum.BROWSER;
  readonly source = ObservationSourceEnum.PLAYWRIGHT;

  constructor(private readonly browser: BrowserService) {}

  isConfigured(): boolean {
    return this.browser.isEnabled() && this.browser.isBrowserInstalled();
  }

  getStatus(): ProviderStatus {
    if (!this.browser.isEnabled()) {
      return {
        platform: this.platform,
        configured: false,
        provider: null,
        reason: '浏览器采集通道已关闭（BROWSER_PROVIDERS_ENABLED=false）',
      };
    }
    if (!this.browser.isBrowserInstalled()) {
      return {
        platform: this.platform,
        configured: false,
        provider: null,
        reason: 'Playwright Chromium 未安装，请先运行 npm run playwright:install',
      };
    }
    return {
      platform: this.platform,
      configured: true,
      provider: this.providerType,
      reason:
        'Playwright 可见浏览器；首次使用请运行 npm run browser:login -- xiaohongshu 扫码登录。网页端可能不提供商城商品搜索入口，此时会明确返回 GOODS_SEARCH_UNAVAILABLE',
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    if (!this.browser.isEnabled()) {
      throw new NotConfiguredError('小红书浏览器采集通道未启用');
    }
    if (!this.browser.isBrowserInstalled()) {
      throw new NotConfiguredError('Playwright Chromium 未安装，请先运行 npm run playwright:install');
    }

    const urls = buildXiaohongshuSearchUrls(keyword);
    const outcome = await this.browser.withPage(this.platform, urls[0], async (page) => {
      let lastNotes = 0;
      let lastUrl = page.url();
      let lastBody = '';
      let lastGoodsMode = false;
      let loginRequired = false;
      let triedGoodsTab = false;

      for (let index = 0; index < urls.length; index += 1) {
        if (index > 0) {
          await page.goto(urls[index], { waitUntil: 'domcontentloaded' });
        }
        await page.waitForTimeout(3000);
        await this.browser.assertNotBlocked(page);

        let scan = await this.scanPage(page);
        if (scan.goods.length > 0) {
          return {
            kind: 'goods',
            cards: scan.goods,
            noteCount: scan.notes,
            goodsModeActive: scan.goodsModeActive,
            url: page.url(),
          } satisfies XiaohongshuSearchOutcome;
        }

        // 网页上如果存在“商品”Tab，点击一次进入商品搜索模式；只做一次，不循环重试。
        if (!triedGoodsTab && index === 0 && (await this.tryClickGoodsTab(page))) {
          triedGoodsTab = true;
          await page.waitForTimeout(2500);
          await this.browser.assertNotBlocked(page);
          scan = await this.scanPage(page);
          if (scan.goods.length > 0) {
            return {
              kind: 'goods',
              cards: scan.goods,
              noteCount: scan.notes,
              goodsModeActive: scan.goodsModeActive,
              url: page.url(),
            } satisfies XiaohongshuSearchOutcome;
          }
        }

        lastNotes = scan.notes;
        lastUrl = page.url();
        lastGoodsMode = scan.goodsModeActive;
        lastBody = await this.browser.bodyText(page);

        if (LOGIN_HINTS.some((hint) => lastBody.includes(hint))) {
          loginRequired = true;
        }

        const noResult = NO_RESULT_HINTS.some((hint) => lastBody.includes(hint));
        const mode = classifyXiaohongshuSearch({
          goodsCount: scan.goods.length,
          noteCount: scan.notes,
          goodsModeActive: scan.goodsModeActive,
          noResultHint: noResult,
        });
        if (mode === 'NO_RESULTS') {
          return { kind: 'empty', url: page.url() } satisfies XiaohongshuSearchOutcome;
        }
        // NOTES_ONLY / UNKNOWN：继续尝试下一个商品搜索入口，笔记不会进入商品集合。
      }

      return {
        kind: 'unavailable',
        noteCount: lastNotes,
        goodsModeActive: lastGoodsMode,
        url: lastUrl,
        body: lastBody.slice(0, 300),
        loginRequired,
      } satisfies XiaohongshuSearchOutcome;
    });

    if (outcome.kind === 'empty') {
      return {
        products: [],
        status: 'EMPTY',
        warnings: ['已进入小红书商品搜索模式，但没有返回商品结果'],
      };
    }

    if (outcome.kind === 'unavailable') {
      if (outcome.loginRequired) {
        throw new BlockedError(
          ProviderErrorCodeEnum.LOGIN_REQUIRED,
          '小红书搜索需要登录：请在任务面板打开验证浏览器完成登录后点击“继续采集”（或运行 npm run browser:login -- xiaohongshu）',
        );
      }
      throw new GoodsSearchUnavailableError(
        this.unavailableMessage(outcome.noteCount, outcome.goodsModeActive),
        outcome.body,
      );
    }

    const products = this.toNormalizedProducts(outcome.cards, options.maxResults);
    if (outcome.cards.length > 0 && products.length === 0) {
      throw new ParseFailedError('小红书页面出现商品卡片，但无法解析出有效商品链接');
    }
    const missingImage = products.filter((product) => product.imageUrls.length === 0).length;
    const unparsedPrice = products.filter(
      (product) => product.price?.amount === null || product.price?.amount === undefined,
    ).length;
    const warnings = [
      '小红书本次进入的是商城商品搜索模式，只提取商品卡片（名称、图片、价格、商品链接）',
      outcome.noteCount > 0
        ? `页面同时存在 ${outcome.noteCount} 条笔记链接，已全部排除，未当作商品`
        : '页面未出现笔记链接',
      '价格仅取页面可见展示价，未确认具体 SKU；目标款式无法确认时由 AI 标记为待确认',
    ];
    if (missingImage > 0 || unparsedPrice > 0) {
      warnings.push(
        `其中 ${missingImage} 个商品未取得图片、${unparsedPrice} 个未解析出普通现价，已如实留空，不填充虚假值`,
      );
    }
    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings,
    };
  }

  private unavailableMessage(noteCount: number, goodsModeActive: boolean): string {
    if (noteCount > 0) {
      return `小红书网页搜索未提供可用的商城商品搜索模式：本次页面只返回了 ${noteCount} 条笔记链接，没有商品卡片。不会把笔记当作商品数据，也不伪造商品。网页浏览器无法唤起官方 deeplink（xhsdiscover://search/result?...&target_search=goods）；如需商城商品数据，请使用 OKData 渠道，或单独搭建 Android 模拟器 + Appium 方案（见 docs/platform-integration.md）。`;
    }
    const head = goodsModeActive
      ? '小红书网页商品搜索模式可进入，但未找到商品卡片'
      : '小红书网页搜索未提供商城商品搜索模式（未出现商品 Tab，也未进入 target_search=goods）';
    return `${head}：本次页面没有可识别的商品卡片。不会把笔记当作商品数据，也不伪造商品。网页浏览器无法唤起官方 deeplink（xhsdiscover://search/result?...&target_search=goods）；如需商城商品数据，请使用 OKData 渠道，或单独搭建 Android 模拟器 + Appium 方案（见 docs/platform-integration.md）。`;
  }

  /** 页面扫描只在浏览器内执行，不能引用 Node 侧函数。 */
  private scanPage(page: Page): Promise<ScanResult> {
    return page.evaluate(() => {
      const isNote = (href: string) =>
        /xiaohongshu\.com\/(explore|discovery_item|discovery\/item)\//i.test(href);
      const isGoods = (href: string) => {
        try {
          const parsed = new URL(href);
          if (!['https:', 'http:'].includes(parsed.protocol)) return false;
          const host = parsed.hostname.toLowerCase();
          const allowedHost =
            host === 'xiaohongshu.com' ||
            host.endsWith('.xiaohongshu.com') ||
            host === 'xhslink.com' ||
            host.endsWith('.xhslink.com');
          if (!allowedHost || isNote(href)) return false;
          const path = parsed.pathname.toLowerCase();
          if (/\/goods-detail(\/|$)/.test(path)) return true;
          if (/\/goods(\/|$)/.test(path)) return true;
          if (/\/product(\/|$)/.test(path)) return true;
          return /[?&](goods_id|product_id)=/.test(parsed.search);
        } catch {
          return false;
        }
      };

      const goods: Array<{
        url: string;
        title: string;
        imageUrl: string;
        priceText: string;
      }> = [];
      const seen = new Set<string>();
      let notes = 0;
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const anchor of anchors) {
        const href = (anchor as HTMLAnchorElement).href;
        if (!href) continue;
        if (isNote(href)) {
          notes += 1;
          continue;
        }
        if (!isGoods(href) || seen.has(href)) continue;
        const card =
          (anchor.closest(
            '[class*="card"], [class*="goods"], [class*="item"], li',
          ) as HTMLElement | null) ?? anchor;
        const img = (anchor.querySelector('img') ??
          card.querySelector('img')) as HTMLImageElement | null;
        const titleEl = card.querySelector(
          '[class*="title"], [class*="name"], [class*="desc"]',
        );
        const title = (titleEl?.textContent ?? anchor.getAttribute('title') ?? anchor.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        if (title.length < 2) continue;
        const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
        seen.add(href);
        goods.push({
          url: href,
          title: title.slice(0, 300),
          imageUrl: img?.currentSrc || img?.src || '',
          priceText: (priceEl?.textContent ?? card.textContent ?? '').slice(0, 400),
        });
        if (goods.length >= 60) break;
      }

      // 只有页面上“商品”标签确实处于选中状态，才认为进入了商品搜索模式。
      // 仅 URL 带 type=goods 不足以证明页面真的切换了模式。
      let goodsModeActive = false;
      const tabs = Array.from(
        document.querySelectorAll('[role="tab"], [class*="tab"], [class*="filter"]'),
      );
      for (const node of tabs) {
        if ((node.textContent ?? '').trim() !== '商品') continue;
        const cls = String((node as HTMLElement).className);
        if (/active|selected|checked/i.test(cls) || node.getAttribute('aria-selected') === 'true') {
          goodsModeActive = true;
          break;
        }
      }
      return { goods, notes, goodsModeActive };
    });
  }

  /** 点击搜索页上的“商品”筛选/标签；找不到或不可见时返回 false。 */
  private tryClickGoodsTab(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('span, div, a, li, button'));
      for (const node of nodes) {
        if (node.childElementCount > 0) continue;
        if ((node.textContent ?? '').trim() !== '商品') continue;
        const clickable =
          node.closest<HTMLElement>('[role="tab"], [class*="tab"]') ?? null;
        if (!clickable || clickable.offsetParent === null) continue;
        clickable.click();
        return true;
      }
      return false;
    });
  }

  private toNormalizedProducts(cards: XiaohongshuSearchCard[], maxResults: number): NormalizedProduct[] {
    const products: NormalizedProduct[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      let parsed: URL;
      try {
        parsed = new URL(card.url);
      } catch {
        continue;
      }
      if (!isXiaohongshuGoodsUrl(card.url)) continue;
      const dedupeKey = parsed.toString();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const idMatch =
        parsed.pathname.match(/\/(?:goods-detail|goods|product)\/([0-9a-zA-Z]+)/) ??
        parsed.search.match(/[?&](?:goods_id|product_id)=([^&]+)/);
      const platformProductId = idMatch ? decodeURIComponent(idMatch[1]) : undefined;
      const imageUrl = toHttpUrl(card.imageUrl);
      const observedAt = nowIso();

      products.push({
        platform: PlatformEnum.XIAOHONGSHU,
        platformProductId,
        title: card.title,
        productUrl: parsed.toString(),
        imageUrls: imageUrl ? [imageUrl] : [],
        skuOptions: [],
        price: parseVisiblePrice(card.priceText, 'xiaohongshu_goods_page'),
        sourceType: SourceTypeEnum.BROWSER,
        source: ObservationSourceEnum.PLAYWRIGHT,
        providerKey: ProviderKeyEnum.PLAYWRIGHT,
        sourceProductId: platformProductId,
        region: 'local_browser',
        regionNote:
          '来自本机登录浏览器的小红书商城商品搜索页，价格与账号地区、登录状态和促销有关',
        collectedAt: observedAt,
        rawData: {
          href: card.url,
          priceText: card.priceText,
          searchMode: 'goods',
        },
      });
      if (products.length >= maxResults) break;
    }
    return products;
  }
}
