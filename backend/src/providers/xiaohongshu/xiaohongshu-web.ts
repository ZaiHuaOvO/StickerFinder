export interface XiaohongshuSearchCard {
  url: string;
  title: string;
  imageUrl: string;
  priceText: string;
}

export type XiaohongshuSearchMode =
  | 'GOODS'
  | 'NOTES_ONLY'
  | 'NO_RESULTS'
  | 'UNKNOWN';

/**
 * 小红书网页搜索入口。官方 deeplink 为
 * xhsdiscover://search/result?keyword=...&target_search=goods，
 * 浏览器无法唤起原生 App，因此依次探测网页端可能存在的商品搜索参数。
 */
export function buildXiaohongshuSearchUrls(keyword: string): string[] {
  const encoded = encodeURIComponent(keyword);
  // 第一项是当前已验证可用的网页搜索页；页面上如存在“商品”Tab 会优先点击进入。
  return [
    `https://www.xiaohongshu.com/search_result?keyword=${encoded}&source=web_search_result_notes&type=51`,
    `https://www.xiaohongshu.com/search_result?keyword=${encoded}&target_search=goods`,
    `https://www.xiaohongshu.com/search_result?keyword=${encoded}&type=goods`,
  ];
}

export function isXiaohongshuNoteUrl(href: string): boolean {
  return /xiaohongshu\.com\/(explore|discovery_item|discovery\/item)\//i.test(href);
}

/**
 * 只有明确的商品详情链接才算商品；笔记链接（/explore/、/discovery/item/）
 * 永远不能进入商品集合。短链 xhslink.com 无法在不访问的情况下判断类型，
 * 只有路径本身带商品标记时才接受。
 */
export function isXiaohongshuGoodsUrl(href: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  const allowedHost =
    host === 'xiaohongshu.com' ||
    host.endsWith('.xiaohongshu.com') ||
    host === 'xhslink.com' ||
    host.endsWith('.xhslink.com');
  if (!allowedHost) return false;
  if (isXiaohongshuNoteUrl(href)) return false;

  const path = parsed.pathname.toLowerCase();
  if (/\/goods-detail(\/|$)/.test(path)) return true;
  if (/\/goods(\/|$)/.test(path)) return true;
  if (/\/product(\/|$)/.test(path)) return true;
  return /[?&](goods_id|product_id)=/.test(parsed.search);
}

export function classifyXiaohongshuSearch(input: {
  goodsCount: number;
  noteCount: number;
  goodsModeActive: boolean;
  noResultHint: boolean;
}): XiaohongshuSearchMode {
  if (input.goodsCount > 0) return 'GOODS';
  if (input.noResultHint) {
    // 只有确认处于商品搜索模式时，空页面才能作为“无商品结果”。
    return input.goodsModeActive ? 'NO_RESULTS' : 'UNKNOWN';
  }
  if (input.noteCount > 0) return 'NOTES_ONLY';
  return 'UNKNOWN';
}
