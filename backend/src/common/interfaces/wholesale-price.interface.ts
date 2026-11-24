/**
 * 1688 等批发平台的采购价格信息。
 * 与零售 PriceInfo 分开保存，禁止用最低批发价参与跨平台零售价格排名。
 */
export interface PriceTier {
  /** 对应价格档位的采购数量门槛 */
  minQuantity: number;
  price: number;
}

export interface WholesalePriceInfo {
  priceMin: number | null;
  priceMax: number | null;
  /** 接口未返回币种时为 null，禁止自行假设为人民币 */
  currency: string | null;
  /** 计价单位，例如“件”“个”；接口未返回时为 null */
  unit: string | null;
  minOrderQuantity: number | null;
  priceTiers: PriceTier[];
  /** 补充的采购条件，接口未返回则为空 */
  note?: string | null;
}
