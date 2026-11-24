import { PlatformStatusEnum, PlatformTaskStatusEnum } from '../enums';

export interface PlatformTaskStatusShape {
  status: PlatformTaskStatusEnum;
  resultCount: number;
}

/**
 * 聚合平台状态：
 * - 任一渠道仍在运行/等待 -> RUNNING/PENDING
 * - 有数据但存在未配置/空/失败/部分成功渠道 -> PARTIAL_SUCCESS
 * - 所有渠道成功 -> SUCCESS
 * - 无数据时按失败/空结果/未配置区分
 */
export function aggregatePlatformStatus(
  tasks: PlatformTaskStatusShape[],
): PlatformStatusEnum {
  if (
    tasks.some((task) => task.status === PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION)
  ) {
    return PlatformStatusEnum.WAITING_MANUAL_VERIFICATION;
  }
  if (tasks.some((task) => task.status === PlatformTaskStatusEnum.CANCELLED)) {
    return PlatformStatusEnum.CANCELLED;
  }
  if (tasks.some((task) => task.status === PlatformTaskStatusEnum.RUNNING)) {
    return PlatformStatusEnum.RUNNING;
  }
  if (tasks.some((task) => task.status === PlatformTaskStatusEnum.PENDING)) {
    return PlatformStatusEnum.PENDING;
  }
  if (tasks.length === 0) return PlatformStatusEnum.NOT_CONFIGURED;

  const notConfigured = tasks.filter(
    (task) => task.status === PlatformTaskStatusEnum.NOT_CONFIGURED,
  );
  const configured = tasks.filter(
    (task) => task.status !== PlatformTaskStatusEnum.NOT_CONFIGURED,
  );
  if (configured.length === 0) return PlatformStatusEnum.NOT_CONFIGURED;

  const withData = configured.filter(
    (task) =>
      task.resultCount > 0 ||
      task.status === PlatformTaskStatusEnum.SUCCESS ||
      task.status === PlatformTaskStatusEnum.PARTIAL_SUCCESS,
  );
  const failures = configured.filter(
    (task) =>
      task.status === PlatformTaskStatusEnum.FAILED ||
      task.status === PlatformTaskStatusEnum.BLOCKED,
  );
  const empties = configured.filter(
    (task) => task.status === PlatformTaskStatusEnum.EMPTY,
  );

  if (withData.length > 0) {
    if (
      withData.length < tasks.length ||
      notConfigured.length > 0 ||
      failures.length > 0 ||
      empties.length > 0 ||
      withData.some((task) => task.status === PlatformTaskStatusEnum.PARTIAL_SUCCESS)
    ) {
      return PlatformStatusEnum.PARTIAL_SUCCESS;
    }
    return PlatformStatusEnum.SUCCESS;
  }

  if (failures.length > 0) return PlatformStatusEnum.FAILED;
  if (empties.length > 0) return PlatformStatusEnum.EMPTY;
  return PlatformStatusEnum.NOT_CONFIGURED;
}
