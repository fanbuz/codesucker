# Changelog

本文件记录 CodeSucker 的用户可见变化，格式遵循 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

暂无。

## [0.1.0] - 2026-07-23

### Added

- 五段代码抽取流水线：发现、清洗、截取分页、渲染和合规校验
- Electron 五步向导、项目配置持久化与 docx/txt 导出
- 产品版本、配置 schema 与合规规则的独立版本追踪
- 统一版本设置、版本一致性检查和 CI 门禁
- 大仓库扫描、清洗与文档渲染的 worker 线程流水线
- 可取消任务、真实阶段进度与单文件错误汇总
- 署名证据保留与跨语言合规回归测试
- 设置页关于区域，展示作者、免费软件属性、许可证与 GitHub 入口
- README 增加基于 Mochi Issue Flow 推进开发的说明
- macOS x64、macOS arm64 与 Windows x64 的可重复安装包构建和 GitHub Release 工作流

### Changed

- 项目许可证由 GPL-3.0 切换为 Apache-2.0
- 设置页版本号由构建时应用版本注入，不再硬编码
- `.codesucker.json` 保存时写入应用版本、配置 schema 和规则版本
- 合规规则版本提升至 `2026.07.1`，署名冲突改为依据清洗前保留的文件、行号、原文与主体信息判断
- 大仓库处理限制在 1–4 个 worker，并保证并发前后的文件顺序、截取结果与审计结果一致
- 运行与打包环境统一为 Node.js 22.12 或更高版本

### Fixed

- 修复删除注释后署名信息丢失，导致冲突申报漏报的问题
- 修复扫描、清洗和 DOCX 渲染长时间阻塞 Electron 主进程的问题
- 修复跨行模板字符串和 Python 三引号字符串中的注释符号被误删
- 修复 0 行、0 页结果被错误标记为可导出
- 修复 Electron 43 下拖入文件夹无法可靠取得路径

### Security

- 固定使用公共 npm 源，并阻止 lockfile 提交非公共依赖下载地址
