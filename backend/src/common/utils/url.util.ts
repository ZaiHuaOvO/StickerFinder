const TRACKING_PARAMS = new Set([
  'spm',
  'scm',
  'pvid',
  'clickid',
  'shareid',
  'source',
  'sourceType',
  'track_id',
  'trackId',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'from',
  'refer',
  'share_token',
]);

/** 仅用于同一次搜索内的去重，不替换商品原始链接 */
export function normalizeProductUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    const search = url.searchParams.toString();
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host.toLowerCase()}${path}${search ? `?${search}` : ''}`;
  } catch {
    return rawUrl.trim();
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** 处理平台常见的协议相对地址（//img.example.com/a.jpg） */
export function toHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  return isHttpUrl(normalized) ? normalized : null;
}
