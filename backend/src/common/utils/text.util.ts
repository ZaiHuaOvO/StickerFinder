const CJK_VARIANTS: Record<string, string> = {
  姸: '妍',
  峯: '峰',
  裏: '里',
  臺: '台',
  喆: '哲',
};

/**
 * 目标/系列名称的检索归一化：全角转半角、去空白、常见异体字统一、英文小写。
 * 只用于比较与 AI 输入，不覆盖用户填写的原始名称。
 */
export function normalizeTargetText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFKC')
    .replace(/[　\s]+/g, '')
    .replace(/[姸峯裏臺喆]/g, (char) => CJK_VARIANTS[char] ?? char)
    .toLowerCase();
}
