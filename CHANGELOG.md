# Changelog

本文件记录 CodeSucker 的用户可见变化，格式遵循 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

### Added

- 五段代码抽取流水线：发现、清洗、截取分页、渲染和合规校验
- Electron 五步向导、项目配置持久化与 docx/txt 导出
- 产品版本、配置 schema 与合规规则的独立版本追踪
- 统一版本设置、版本一致性检查和 CI 门禁

### Changed

- 项目许可证由 GPL-3.0 切换为 Apache-2.0
- 设置页版本号由构建时应用版本注入，不再硬编码
- `.codesucker.json` 保存时写入应用版本、配置 schema 和规则版本

### Fixed

- 暂无

### Security

- 暂无
