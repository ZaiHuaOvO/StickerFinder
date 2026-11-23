import { normalizeProductUrl } from './url.util';

export interface DedupeProductShape {
  platformProductId?: string | null;
  title: string;
  shopName?: string | null;
  productUrl: string;
  imageUrls?: string[];
}

export function normalizeTitle(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[\s\-_/\\|,，。.、;；:：!！?？'"“”‘’()（）[\]【】{}<>《》+~～*#@&%$￥¥]/g, '')
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (text: string): Set<string> => {
    const set = new Set<string>();
    if (text.length <= 2) {
      set.add(text);
      return set;
    }
    for (let i = 0; i < text.length - 1; i += 1) {
      set.add(text.slice(i, i + 2));
    }
    return set;
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  let intersection = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) intersection += 1;
  }
  const union = leftGrams.size + rightGrams.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function normalizedImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function imageOverlap(a: string[] | undefined, b: string[] | undefined): number {
  const left = new Set((a ?? []).map(normalizedImageUrl).filter(Boolean));
  const right = new Set((b ?? []).map(normalizedImageUrl).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const image of left) {
    if (right.has(image)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

export type StrongMatchReason =
  | 'strong:id'
  | 'strong:url'
  | 'strong:title_shop'
  | null;

export function strongProductMatch(
  a: DedupeProductShape,
  b: DedupeProductShape,
): StrongMatchReason {
  const leftId = a.platformProductId?.trim();
  const rightId = b.platformProductId?.trim();
  if (leftId && rightId && leftId === rightId) {
    return 'strong:id';
  }

  const leftUrl = normalizeProductUrl(a.productUrl);
  const rightUrl = normalizeProductUrl(b.productUrl);
  if (leftUrl && rightUrl && leftUrl === rightUrl) {
    return 'strong:url';
  }

  const leftTitle = normalizeTitle(a.title);
  const rightTitle = normalizeTitle(b.title);
  const leftShop = normalizeTitle(a.shopName);
  const rightShop = normalizeTitle(b.shopName);
  if (leftTitle.length >= 8 && leftTitle === rightTitle && leftShop && leftShop === rightShop) {
    return 'strong:title_shop';
  }

  return null;
}

export function isAmbiguousSameProduct(
  a: DedupeProductShape,
  b: DedupeProductShape,
): boolean {
  if (strongProductMatch(a, b)) return false;
  if (imageOverlap(a.imageUrls, b.imageUrls) >= 0.34) return true;
  return titleSimilarity(a.title, b.title) >= 0.7;
}
