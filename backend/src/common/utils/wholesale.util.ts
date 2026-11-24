import { WholesalePriceInfo } from '../interfaces/wholesale-price.interface';

/**
 * 合并同一商品的批发价时，禁止用两次请求拼出价格区间。
 * 若一组价格没有上限/阶梯价、另一组有，则整组采用更完整的一组。
 */
export function mergeWholesale(
  existing: WholesalePriceInfo,
  incoming: WholesalePriceInfo,
): WholesalePriceInfo {
  const incomingComplete =
    incoming.priceMax !== null || incoming.priceTiers.length > 0;
  const existingComplete =
    existing.priceMax !== null || existing.priceTiers.length > 0;
  if (incomingComplete && !existingComplete) return incoming;

  return {
    priceMin: existing.priceMin,
    priceMax: existing.priceMax,
    priceTiers: existing.priceTiers,
    currency: existing.currency ?? incoming.currency,
    unit: existing.unit ?? incoming.unit,
    minOrderQuantity:
      existing.minOrderQuantity ?? incoming.minOrderQuantity,
    note: existing.note ?? incoming.note ?? null,
  };
}
