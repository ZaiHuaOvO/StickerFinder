import { PriceTypeEnum } from '../../common/enums';
import { PriceInfo } from '../../common/interfaces/price.interface';
import { nowIso } from '../../common/utils/date.util';

/**
 * 浏览器卡片上的可见价格只能作为“展示价”处理：
 * 不把它冒充目标 SKU 价；区间价不取中间值或最低值，只如实展示区间。
 */
export function parseVisiblePrice(priceText: string, priceSource: string): PriceInfo {
  const text = priceText.replace(/\s+/g, ' ');
  const observedAt = nowIso();

  const range = text.match(
    /¥\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:-|~|～|至|—)\s*¥?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
  );
  if (range) {
    const low = Number.parseFloat(range[1]);
    const high = Number.parseFloat(range[2]);
    if (Number.isFinite(low) && low > 0 && Number.isFinite(high) && high > 0) {
      return {
        amount: null,
        currency: 'CNY',
        displayText: `¥${low.toFixed(2)}–¥${high.toFixed(2)}`,
        priceType: PriceTypeEnum.UNKNOWN,
        priceSource,
        observedAt,
        shippingIncluded: 'unknown',
        note: '页面展示价格区间，无法确认具体 SKU 价格；最低价格仅为区间下限',
      };
    }
  }

  const single = text.match(/¥\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  const amount = single ? Number.parseFloat(single[1]) : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      amount: null,
      currency: 'CNY',
      displayText: '未获取',
      priceType: PriceTypeEnum.UNKNOWN,
      priceSource,
      observedAt,
      shippingIncluded: 'unknown',
      note: '页面未展示可解析的价格',
    };
  }

  const couponLike = /券后|到手价|折后|活动价|补贴/.test(text);
  if (couponLike) {
    return {
      amount: null,
      currency: 'CNY',
      displayText: `¥${amount.toFixed(2)}`,
      priceType: PriceTypeEnum.UNKNOWN,
      priceSource,
      observedAt,
      shippingIncluded: 'unknown',
      note: '页面仅展示可能为券后/活动价的金额，未确认普通现价；不主动计算个人优惠',
    };
  }

  const starting = /起/.test(text);
  const notes = ['页面可见展示价'];
  if (starting) {
    notes.push('为起售价');
  }
  notes.push('未确认具体 SKU');

  return {
    amount,
    currency: 'CNY',
    displayText: starting ? `¥${amount.toFixed(2)} 起` : `¥${amount.toFixed(2)}`,
    priceType: starting ? PriceTypeEnum.LOWEST_SKU : PriceTypeEnum.LISTING,
    priceSource,
    observedAt,
    shippingIncluded: 'unknown',
    note: notes.join('，'),
  };
}
