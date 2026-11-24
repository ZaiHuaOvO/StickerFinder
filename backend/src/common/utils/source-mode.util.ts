import { SourceSelectionModeEnum } from '../enums';

/** 未设置时默认 PRIMARY：每个平台只使用主数据源。 */
export function parseSourceMode(
  value: string | undefined,
): SourceSelectionModeEnum {
  switch ((value ?? '').trim().toUpperCase()) {
    case 'PARALLEL':
      return SourceSelectionModeEnum.PARALLEL;
    case 'FALLBACK':
      return SourceSelectionModeEnum.FALLBACK;
    case 'PRIMARY':
    default:
      return SourceSelectionModeEnum.PRIMARY;
  }
}
