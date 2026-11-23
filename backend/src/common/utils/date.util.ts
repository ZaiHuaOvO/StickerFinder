function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** 返回带本地时区偏移的 ISO 8601 字符串，例如 2026-11-20T12:00:00+08:00 */
export function nowIso(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`
  );
}

/** 淘宝 TOP 网关要求 GMT+8 的 yyyy-MM-dd HH:mm:ss */
export function formatTaobaoTimestamp(date: Date = new Date()): string {
  const shanghai = new Date(date.getTime() + 8 * 3600_000);
  return (
    `${shanghai.getUTCFullYear()}-${pad(shanghai.getUTCMonth() + 1)}-${pad(shanghai.getUTCDate())} ` +
    `${pad(shanghai.getUTCHours())}:${pad(shanghai.getUTCMinutes())}:${pad(shanghai.getUTCSeconds())}`
  );
}

export function unixSeconds(date: Date = new Date()): string {
  return String(Math.floor(date.getTime() / 1000));
}
