import { ProviderErrorCodeEnum } from '../enums';

export interface ManualVerificationDecision {
  action: 'PAUSE' | 'FAIL';
  attempts: number;
}

/** 只有验证码与登录是人工可在浏览器中解决的问题；访问限制不提供“继续采集”。 */
export function isManualResolvableBlock(code: string | null | undefined): boolean {
  return (
    code === ProviderErrorCodeEnum.CAPTCHA_REQUIRED ||
    code === ProviderErrorCodeEnum.LOGIN_REQUIRED
  );
}

/**
 * 决定下一次拦截是继续暂停等待人工处理，还是明确失败。
 * attempts 是“已经暂停过几次”，最多允许 maxAttempts 次；超出后不再无限重试。
 */
export function decideManualVerification(
  existingAttempts: number,
  maxAttempts: number,
): ManualVerificationDecision {
  const attempts = Math.max(0, existingAttempts) + 1;
  const limit = Math.max(0, maxAttempts);
  return { action: attempts > limit ? 'FAIL' : 'PAUSE', attempts };
}

export function manualVerificationFailMessage(attempts: number, maxAttempts: number): string {
  return `人工验证已尝试 ${attempts - 1} 次，达到上限 ${maxAttempts} 次后仍被平台拦截；不再自动重试。请检查登录状态、账号环境或稍后手动处理。`;
}
