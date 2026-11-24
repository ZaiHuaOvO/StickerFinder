export type EveryInfraPlatform =
  | 'taobao'
  | 'douyin'
  | 'xiaohongshu'
  | 'alibaba1688';

/** 官方文档规定的 platform/action 组合，不得自行修改 */
export const EVERYINFRA_ACTIONS = {
  taobao: { search: 'search', detail: 'product_detail' },
  douyin: { search: 'product_search', detail: 'product_detail' },
  xiaohongshu: { search: 'product_search', detail: 'product_detail' },
  alibaba1688: {
    search: 'search',
    detail: 'product_detail',
    imageSearch: 'image_search',
  },
} as const;

export interface EveryInfraRequest {
  platform: EveryInfraPlatform;
  action: string;
  params: Record<string, unknown>;
}

export interface EveryInfraBilling {
  charged?: boolean;
  charged_usd?: number | null;
  balance_after_usd?: number | null;
}

export interface EveryInfraCallResult {
  platform: EveryInfraPlatform;
  action: string;
  /** 从 results/data 中解析出的候选数组；详情接口可能只有一个对象 */
  items: unknown[];
  count: number | null;
  billing: EveryInfraBilling | null;
  requestId: string | null;
  raw: Record<string, unknown>;
}
