import { Injectable } from '@nestjs/common';
import {
  BlockedError,
  NotConfiguredError,
  ParseFailedError,
} from '../../common/errors/provider.errors';
import { PlatformEnum, SourceTypeEnum } from '../../common/enums';
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
import { parseVisiblePrice } from '../shared/browser-price';

interface ExtractedCard {
  url: string;
  title: string;
  imageUrl: string;
  priceText: string;
}

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

@Injectable()
export class DouyinProvider implements PlatformProvider {
  readonly platform = PlatformEnum.DOUYIN;
  readonly providerType = SourceTypeEnum.BROWSER;

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
      reason: 'Playwright 可见浏览器；首次使用请运行 npm run browser:login -- douyin 扫码登录',
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    if (!this.browser.isEnabled()) {
      throw new NotConfiguredError('抖音浏览器采集通道未启用');
    }
    if (!this.browser.isBrowserInstalled()) {
      throw new NotConfiguredError('Playwright Chromium 未安装，请先运行 npm run playwright:install');
    }

    const encoded = encodeURIComponent(keyword);
    const primaryUrl = `https://www.douyin.com/search/${encoded}?type=goods`;
    const fallbackUrl = `https://www.douyin.com/search/${encoded}?type=general`;

    const result = await this.browser.withPage(this.platform, primaryUrl, async (page) => {
      await page.waitForTimeout(3000);
      await this.browser.assertNotBlocked(page);

      let extracted = await this.extractCards(page);
      if (extracted.length === 0) {
        await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await this.browser.assertNotBlocked(page);
        extracted = await this.extractCards(page);
      }

      if (extracted.length === 0) {
        const body = await this.browser.bodyText(page);
        if (LOGIN_HINTS.some((hint) => body.includes(hint))) {
          throw new BlockedError(
            'LOGIN_REQUIRED',
            '抖音搜索需要登录：请运行 npm run browser:login -- douyin 完成扫码登录后重试',
          );
        }
        if (NO_RESULT_HINTS.some((hint) => body.includes(hint))) {
          return { cards: [], empty: true };
        }
        throw new ParseFailedError(
          '抖音搜索页未发现可识别的商品卡片，可能是未登录、页面结构变化或该关键词没有商品结果',
          body.slice(0, 300),
        );
      }
      return { cards: extracted, empty: false };
    });

    if (result.empty) {
      return {
        products: [],
        status: 'EMPTY',
        warnings: ['抖音搜索页可访问，但没有返回匹配的候选商品'],
      };
    }

    const products = this.toNormalizedProducts(result.cards, options.maxResults);
    if (result.cards.length > 0 && products.length === 0) {
      throw new ParseFailedError('抖音页面出现商品卡片，但无法解析出有效商品链接');
    }
    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings: ['抖音网页解析为实验能力，仅提取页面可见的商品链接、标题与价格'],
    };
  }

  private async extractCards(page: import('playwright').Page): Promise<ExtractedCard[]> {
    return page.evaluate(() => {
      const results: Array<{
        url: string;
        title: string;
        imageUrl: string;
        priceText: string;
      }> = [];
      const seen = new Set<string>();
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const anchor of anchors) {
        const href = (anchor as HTMLAnchorElement).href;
        if (!href || seen.has(href)) continue;
        if (!/(haohuo\.jinritemai\.com|douyin\.com\/(goods|product)|item2)/i.test(href)) {
          continue;
        }
        const img = anchor.querySelector('img') as HTMLImageElement | null;
        const text = (anchor.getAttribute('title') ?? anchor.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length < 2) continue;
        seen.add(href);
        results.push({
          url: href,
          title: text.slice(0, 300),
          imageUrl: img?.currentSrc || img?.src || '',
          priceText: (anchor.textContent ?? '').slice(0, 500),
        });
        if (results.length >= 60) break;
      }
      return results;
    });
  }

  private toNormalizedProducts(cards: ExtractedCard[], maxResults: number): NormalizedProduct[] {
    const products: NormalizedProduct[] = [];
    const seen = new Set<string>();
    for (const card of cards) {
      let parsed: URL;
      try {
        parsed = new URL(card.url);
      } catch {
        continue;
      }
      if (!['https:', 'http:'].includes(parsed.protocol)) continue;
      const host = parsed.hostname.toLowerCase();
      const allowedHost =
        host === 'douyin.com' ||
        host.endsWith('.douyin.com') ||
        host === 'jinritemai.com' ||
        host.endsWith('.jinritemai.com');
      if (!allowedHost) continue;
      const dedupeKey = parsed.toString();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const idMatch = parsed.search.match(/[?&](?:id|product_id)=([^&]+)/);
      const platformProductId = idMatch ? decodeURIComponent(idMatch[1]) : undefined;
      const imageUrl = toHttpUrl(card.imageUrl);
      const observedAt = nowIso();

      products.push({
        platform: PlatformEnum.DOUYIN,
        platformProductId,
        title: card.title,
        productUrl: parsed.toString(),
        imageUrls: imageUrl ? [imageUrl] : [],
        skuOptions: [],
        price: parseVisiblePrice(card.priceText, 'douyin_page'),
        sourceType: SourceTypeEnum.BROWSER,
        collectedAt: observedAt,
        rawData: {
          href: card.url,
          priceText: card.priceText,
        },
      });
      if (products.length >= maxResults) break;
    }
    return products;
  }
}
