/**
 * 浏览器渠道被验证码/登录拦截后保存的恢复信息。
 * 持久化在 PlatformSearchTask.manualVerification 中，进程重启后仍可打开验证浏览器并继续采集。
 */
export interface ManualVerificationProgress {
  /** 已结束（成功/失败/空/未配置）的渠道任务数 */
  completedTasks: number;
  totalTasks: number;
  /** 已完成的平台 */
  completedPlatforms: string[];
  /** 尚未处理的平台（含当前暂停平台之后的平台） */
  remainingPlatforms: string[];
}

export interface ManualVerificationState {
  /** 发起搜索时使用的关键词 */
  keyword: string;
  /** 被拦截时页面所在的目标 URL */
  targetUrl: string;
  /** 该平台独立的持久化用户数据目录 */
  profileDir: string;
  /** 已暂停等待人工处理的次数（用于限制重试，不做无限重试） */
  attempts: number;
  maxAttempts: number;
  /** 最近一次进入等待状态的原因 */
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  requestedAt: string;
  /** 最近一次打开验证浏览器的时间 */
  openedAt: string | null;
  /** 最近一次点击“继续采集”的时间 */
  resumedAt: string | null;
  progress: ManualVerificationProgress;
}
