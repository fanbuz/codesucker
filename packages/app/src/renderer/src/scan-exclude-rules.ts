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
  if (!pathLikeValue) return { normalized, error: 'Rule cannot be empty' };
  if (pathLikeValue.startsWith('/') || WINDOWS_DRIVE_PATH.test(pathLikeValue)) {
    return { normalized, error: 'Only relative paths within project are allowed, not absolute paths' };
  }
  if (pathLikeValue.split('/').includes('..')) {
    return { normalized, error: 'Cannot use .. to navigate outside project directory' };
  }
  if (ILLEGAL_PATH_CHARACTERS.test(pathLikeValue) || pathLikeValue.startsWith('!')) {
    return { normalized, error: 'Contains unsupported characters for path rules' };
  }
  if (!normalized) return { normalized, error: 'Rule cannot point to project root directory' };
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
    return (normalizedCounts.get(result.normalized) ?? 0) > 1 ? 'Duplicate rule, please keep only one' : null;
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
