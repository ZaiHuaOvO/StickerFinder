import { ProviderErrorCodeEnum } from '../enums';

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class NotConfiguredError extends ProviderError {
  constructor(message: string) {
    super(ProviderErrorCodeEnum.PROVIDER_NOT_CONFIGURED, message);
    this.name = 'NotConfiguredError';
  }
}

/**
 * 需要人工在可见浏览器中处理（验证码/登录）的拦截。
 * browserUrl / profileDir 由 BrowserService 在捕获时补全，用于后续恢复。
 */
export class BlockedError extends ProviderError {
  browserUrl?: string;
  profileDir?: string;

  constructor(code: string, message: string, details?: string) {
    super(code, message, details);
    this.name = 'BlockedError';
  }
}

/** 页面结构变化、接口返回无法解析等 */
export class ParseFailedError extends ProviderError {
  constructor(message: string, details?: string) {
    super(ProviderErrorCodeEnum.PARSE_FAILED, message, details);
    this.name = 'ParseFailedError';
  }
}

/**
 * 当前网页无法进入商城商品搜索模式（例如小红书网页只提供笔记搜索）。
 * 这不是“解析失败”，不能把笔记当作商品，也不能伪造商品数据。
 */
export class GoodsSearchUnavailableError extends ProviderError {
  constructor(message: string, details?: string) {
    super(ProviderErrorCodeEnum.GOODS_SEARCH_UNAVAILABLE, message, details);
    this.name = 'GoodsSearchUnavailableError';
  }
}
