export interface ScanExcludeRuleValidation {
  normalized: string;
  error: string | null;
}

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:\//;
const ILLEGAL_PATH_CHARACTERS = /[\u0000-\u001f\u007f<>:"|]/;

export function normalizeScanExcludeRule(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/{2,}/g, '/').split('/')
    .filter((segment) => segment !== '.' && segment !== '')
    .join('/');
}

export function validateScanExcludeRule(value: string): ScanExcludeRuleValidation {
  const pathLikeValue = value.trim().replaceAll('\\', '/');
  const normalized = normalizeScanExcludeRule(value);
  if (!pathLikeValue) return { normalized, error: '规则不能为空' };
  if (pathLikeValue.startsWith('/') || WINDOWS_DRIVE_PATH.test(pathLikeValue)) {
    return { normalized, error: '仅支持项目内的相对路径，不能使用绝对路径' };
  }
  if (pathLikeValue.split('/').includes('..')) {
    return { normalized, error: '不能使用 .. 访问项目目录之外' };
  }
  if (ILLEGAL_PATH_CHARACTERS.test(pathLikeValue) || pathLikeValue.startsWith('!')) {
    return { normalized, error: '包含路径规则不支持的字符' };
  }
  if (!normalized) return { normalized, error: '规则不能指向项目根目录' };
  return { normalized, error: null };
}

export function getScanExcludeRuleErrors(rules: string[]): Array<string | null> {
  const normalizedCounts = new Map<string, number>();
  for (const rule of rules) {
    const normalized = normalizeScanExcludeRule(rule);
    if (normalized) normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1);
  }

  return rules.map((rule) => {
    const result = validateScanExcludeRule(rule);
    if (result.error) return result.error;
    return (normalizedCounts.get(result.normalized) ?? 0) > 1 ? '规则重复，请保留一条' : null;
  });
}

export function normalizeScanExcludeRules(rules: string[]): string[] {
  return [...new Set(rules.map(normalizeScanExcludeRule))];
}

export function sameScanExcludeRules(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((rule, index) => rule === right[index]);
}

export function canResetScanExcludeRules(
  source: 'default' | 'user',
  dirty: boolean,
  warning: string | null,
): boolean {
  return source === 'user' || dirty || warning !== null;
}
