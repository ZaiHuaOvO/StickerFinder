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
    super('PROVIDER_NOT_CONFIGURED', message);
    this.name = 'NotConfiguredError';
  }
}

export class BlockedError extends ProviderError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'BlockedError';
  }
}

/** 页面结构变化、接口返回无法解析等 */
export class ParseFailedError extends ProviderError {
  constructor(message: string, details?: string) {
    super('PARSE_FAILED', message, details);
    this.name = 'ParseFailedError';
  }
}
