const SENSITIVE_KEY = /(token|secret|cookie|authorization|api[_-]?key|password|credential)/i;

/**
 * 只对前端/数据库保存必要原始数据，并限制体积与敏感字段。
 * 平台原始响应可能包含签名参数或临时凭证，不允许原样进入 API。
 */
export function sanitizeRawData(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[truncated-depth]';
  if (typeof value === 'string') {
    return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeRawData(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 100);
    for (const [key, item] of entries) {
      result[key] = SENSITIVE_KEY.test(key)
        ? '[redacted]'
        : sanitizeRawData(item, depth + 1);
    }
    return result;
  }
  return String(value);
}
