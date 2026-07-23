export type ExcludeRuleKind = 'directory' | 'glob';

export type ExcludeRuleValidationCode =
  | 'empty'
  | 'absolute-path'
  | 'parent-traversal'
  | 'root-directory'
  | 'invalid-character';

export type ExcludeRuleValidation =
  | {
      valid: true;
      value: string;
      kind: ExcludeRuleKind;
    }
  | {
      valid: false;
      input: string;
      code: ExcludeRuleValidationCode;
      message: string;
    };

export class ExcludeRuleValidationError extends Error {
  readonly code: ExcludeRuleValidationCode;
  readonly input: string;

  constructor(result: Extract<ExcludeRuleValidation, { valid: false }>) {
    super(result.message);
    this.name = 'ExcludeRuleValidationError';
    this.code = result.code;
    this.input = result.input;
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED_CHARACTERS = /[<>:"|]/;
const GLOB_META_CHARACTERS = /[*?\[\]{}]/;

/**
 * 将用户输入的排除规则转换为跨平台、项目相对的 POSIX 路径形式。
 *
 * 反斜杠只作为 Windows 路径分隔符处理，不作为 glob 转义符使用。
 */
export function validateExcludeRule(input: string): ExcludeRuleValidation {
  const original = input;
  let value = input.trim().replace(/\\/g, '/');

  if (!value) return invalid(original, 'empty', '排除规则不能为空');
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) {
    return invalid(original, 'absolute-path', '排除规则必须是项目相对路径，不能使用绝对路径');
  }
  if (CONTROL_CHARACTERS.test(value) || WINDOWS_RESERVED_CHARACTERS.test(value) || value.startsWith('!')) {
    return invalid(original, 'invalid-character', '排除规则包含不支持的字符');
  }

  value = value.replace(/\/{2,}/g, '/');
  const segments = value.split('/');
  if (segments.includes('..')) {
    return invalid(original, 'parent-traversal', '排除规则不能包含父目录跳转（..）');
  }

  value = segments.filter((segment) => segment !== '.' && segment !== '').join('/');
  if (!value) return invalid(original, 'root-directory', '排除规则不能指向项目根目录');

  return {
    valid: true,
    value,
    kind: GLOB_META_CHARACTERS.test(value) ? 'glob' : 'directory',
  };
}

/** 规范化并稳定去重；存在非法规则时拒绝整组规则。 */
export function normalizeExcludeRules(rules: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const input of rules) {
    const result = validateExcludeRule(input);
    if (!result.valid) throw new ExcludeRuleValidationError(result);
    if (seen.has(result.value)) continue;
    seen.add(result.value);
    normalized.push(result.value);
  }
  return normalized;
}

/** 将公共规则模型编译为 fast-glob 的 ignore patterns。 */
export function compileExcludePatterns(rules: readonly string[]): string[] {
  return normalizeExcludeRules(rules).flatMap((rule) => {
    const isGlob = GLOB_META_CHARACTERS.test(rule);
    if (isGlob) {
      const pattern = rule.includes('/') ? rule : `**/${rule}`;
      // fast-glob 匹配到目录节点时不会自动将 ignore 扩展到子树。
      // 同时编译后代模式，使 packages/*/dist 类目录 glob 能阻止遍历；
      // 对 *.min.js 类文件 glob，该附加模式不会匹配任何后代。
      return [pattern, `${pattern}/**`];
    }
    return [rule.includes('/') ? `${rule}/**` : `**/${rule}/**`];
  });
}

function invalid(
  input: string,
  code: ExcludeRuleValidationCode,
  message: string,
): Extract<ExcludeRuleValidation, { valid: false }> {
  return { valid: false, input, code, message };
}
