import {
  PlatformTaskStatusEnum,
  SearchRunStatusEnum,
} from '../enums';

export interface RunOutcomeTask {
  platform: string;
  status: PlatformTaskStatusEnum;
  errorCode?: string | null;
}

export interface RunOutcome {
  status: SearchRunStatusEnum;
  errorMessage: string | null;
}

const USABLE: ReadonlySet<PlatformTaskStatusEnum> = new Set([
  PlatformTaskStatusEnum.SUCCESS,
  PlatformTaskStatusEnum.PARTIAL_SUCCESS,
  // 空结果也是平台正常响应，不算失败。
  PlatformTaskStatusEnum.EMPTY,
]);

const UNSUCCESSFUL: ReadonlySet<PlatformTaskStatusEnum> = new Set([
  PlatformTaskStatusEnum.FAILED,
  PlatformTaskStatusEnum.BLOCKED,
  PlatformTaskStatusEnum.NOT_CONFIGURED,
  PlatformTaskStatusEnum.CANCELLED,
  // 正常结束时不应残留；出现说明该平台流程异常，不能算成功。
  PlatformTaskStatusEnum.PENDING,
  PlatformTaskStatusEnum.RUNNING,
]);

/**
 * 由各渠道任务的最终状态得出整次搜索的状态：
 * 全部平台可用 → COMPLETED；全部平台不可用 → FAILED；其余 → PARTIAL。
 * FALLBACK 模式下同一平台可能有多个渠道，只要有一个渠道可用就算该平台可用。
 */
export function computeRunOutcome(tasks: RunOutcomeTask[]): RunOutcome {
  if (tasks.length === 0) {
    return { status: SearchRunStatusEnum.COMPLETED, errorMessage: null };
  }

  const byPlatform = new Map<string, RunOutcomeTask[]>();
  for (const task of tasks) {
    const list = byPlatform.get(task.platform) ?? [];
    list.push(task);
    byPlatform.set(task.platform, list);
  }

  const platforms = [...byPlatform.entries()];
  const usable = platforms.filter(([, list]) =>
    list.some((task) => USABLE.has(task.status)),
  );
  const unsuccessful = platforms.filter(([, list]) =>
    list.every((task) => UNSUCCESSFUL.has(task.status)),
  );

  if (unsuccessful.length === 0) {
    return { status: SearchRunStatusEnum.COMPLETED, errorMessage: null };
  }

  const details = unsuccessful
    .map(([platform, list]) => {
      const code = list.find((task) => task.errorCode)?.errorCode;
      const status = list[0]?.status;
      return `${platform}（${code ?? status}）`;
    })
    .join('、');

  if (usable.length === 0) {
    return {
      status: SearchRunStatusEnum.FAILED,
      errorMessage: `所有平台均未完成采集：${details}`,
    };
  }

  return {
    status: SearchRunStatusEnum.PARTIAL,
    errorMessage: `部分平台未完成采集：${details}`,
  };
}
