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
export class XiaohongshuProvider implements PlatformProvider {
  readonly platform = PlatformEnum.XIAOHONGSHU;
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
      reason:
        'Playwright 可见浏览器；首次使用请运行 npm run browser:login -- xiaohongshu 扫码登录',
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    if (!this.browser.isEnabled()) {
      throw new NotConfiguredError('小红书浏览器采集通道未启用');
    }
    if (!this.browser.isBrowserInstalled()) {
      throw new NotConfiguredError('Playwright Chromium 未安装，请先运行 npm run playwright:install');
    }

    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(
      keyword,
    )}&source=web_search_result_notes&type=51`;

    const result = await this.browser.withPage(this.platform, url, async (page) => {
      await page.waitForTimeout(4000);
      await this.browser.assertNotBlocked(page);

      const extracted = await page.evaluate(() => {
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
          if (/xiaohongshu\.com\/(explore|discovery_item|discovery\/item)\//i.test(href)) {
            notes += 1;
            continue;
          }
          if (!/(goods|item|product)/i.test(href)) continue;
          if (!/(xiaohongshu\.com|xhslink\.com)/i.test(href)) continue;
          if (seen.has(href)) continue;
          const img = anchor.querySelector('img') as HTMLImageElement | null;
          const text = (anchor.getAttribute('title') ?? anchor.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length < 2) continue;
          seen.add(href);
          goods.push({
            url: href,
            title: text.slice(0, 300),
            imageUrl: img?.currentSrc || img?.src || '',
            priceText: (anchor.textContent ?? '').slice(0, 500),
          });
          if (goods.length >= 60) break;
        }
        return { goods, notes };
      });

      if (extracted.goods.length === 0) {
        const body = await this.browser.bodyText(page);
        if (LOGIN_HINTS.some((hint) => body.includes(hint))) {
          throw new BlockedError(
            'LOGIN_REQUIRED',
            '小红书搜索需要登录：请运行 npm run browser:login -- xiaohongshu 完成扫码登录后重试',
          );
        }
        if (extracted.notes > 0) {
          throw new ParseFailedError(
            '小红书搜索只返回了笔记，未出现可识别的商品链接；不能把笔记内容当作商品数据',
            body.slice(0, 300),
          );
        }
        if (NO_RESULT_HINTS.some((hint) => body.includes(hint))) {
          return { cards: [], noteCount: 0, empty: true };
        }
        throw new ParseFailedError(
          '小红书搜索页未发现商品或笔记卡片，可能是未登录、页面结构变化或被风控拦截',
          body.slice(0, 300),
        );
      }
      return { cards: extracted.goods, noteCount: extracted.notes, empty: false };
    });

    if (result.empty) {
      return {
        products: [],
        status: 'EMPTY',
        warnings: ['小红书搜索页可访问，但没有返回商品或笔记结果'],
      };
    }

    const products = this.toNormalizedProducts(result.cards, options.maxResults);
    if (result.cards.length > 0 && products.length === 0) {
      throw new ParseFailedError('小红书页面出现商品卡片，但无法解析出有效商品链接');
    }
    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings: [
        `小红书解析为实验能力，页面同时存在 ${result.noteCount} 条笔记链接`,
        '仅提取页面可见的商品链接、标题与价格，无法确认 SKU 时由 AI 标记为待确认',
      ],
    };
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
        host === 'xiaohongshu.com' ||
        host.endsWith('.xiaohongshu.com') ||
        host === 'xhslink.com' ||
        host.endsWith('.xhslink.com');
      if (!allowedHost) continue;
      const dedupeKey = parsed.toString();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const idMatch =
        parsed.pathname.match(/\/(?:goods|item|product)\/([0-9a-zA-Z]+)/) ??
        parsed.search.match(/[?&](?:id|goods_id)=([^&]+)/);
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
        price: parseVisiblePrice(card.priceText, 'xiaohongshu_page'),
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
