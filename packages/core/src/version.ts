/** 项目配置文件结构版本；仅在出现不兼容字段变化时递增。 */
export const CONFIG_SCHEMA_VERSION = 1 as const;

/** 内置申报校验规则版本；规则口径变化时独立于应用版本递增。 */
export const RULES_VERSION = '2026.07.2' as const;

/** 第三方代码线索规则版本；不影响软著合规审计结论。 */
export const THIRD_PARTY_RULES_VERSION = '2026.08.2' as const;
