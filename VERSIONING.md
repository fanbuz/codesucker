# CodeSucker 版本与发布规范

本文是 CodeSucker 产品版本、配置兼容、规则追踪和 Git 发布的唯一标准。README 只保留摘要；发生冲突时以本文和自动校验脚本为准。

## 版本维度

| 版本 | 示例 | 用途 | 来源 |
|---|---|---|---|
| 产品版本 | `0.1.0` | 用户看到的应用与安装包版本 | 三个 `package.json`，由脚本同步 |
| 构建版本 | Git SHA / Actions run number | 定位同一产品版本的具体构建 | CI 环境，不写回源码 |
| 配置结构版本 | `1` | 迁移 `.codesucker.json` | `CONFIG_SCHEMA_VERSION` |
| 合规规则版本 | `2026.07.1` | 追踪生成时采用的校验规则口径 | `RULES_VERSION` |

产品版本、配置结构版本和规则版本相互独立，不得用升级产品补丁版本代替配置迁移或规则版本记录。

## 产品版本：Semantic Versioning

产品版本严格使用 SemVer，不在 `package.json` 中添加 `v` 前缀：

- `0.1.1`：修复缺陷，不增加明显功能，不改变兼容行为
- `0.2.0`：增加用户可见功能，或改变处理、配置、输出行为
- `1.0.0`：公开兼容承诺后的首个稳定版本
- `0.1.0-beta.1`：公开测试版
- `0.1.0-rc.1`：候选发布版，只接受发布阻断修复

Git tag 必须使用 `v<SemVer>`，例如 `v0.1.0`、`v0.2.0-beta.1`。

### 1.0.0 前的兼容约定

- patch 版本必须保持 `.codesucker.json` 向后兼容
- minor 版本可以调整未稳定的内部 API，但应迁移已有项目配置
- 删除用户可见能力、改变默认清洗结果或改变输出格式时，至少提升 minor 版本
- 已发布版本的安装包和 tag 不得覆盖或移动

## 单一版本操作入口

根包、桌面应用、core 包和 lockfile 当前保持同一产品版本。禁止手工只修改其中一个文件。

设置版本：

```bash
npm run version:set -- 0.2.0-beta.1
```

脚本同步以下位置：

- `package.json`
- `packages/app/package.json`
- `packages/core/package.json`
- `package-lock.json` 的根包和 workspace 记录

校验版本：

```bash
npm run version:check
npm run verify
```

`verify` 会依次执行版本一致性校验、测试和完整构建。

## 配置结构版本

新保存的 `.codesucker.json` 必须包含：

```json
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "rulesVersion": "2026.07.1"
}
```

变更规则：

- 新增可选字段且旧版本可安全忽略：不提升 schema
- 删除、改名、改变字段类型或语义：提升 schema
- 读取低版本 schema 时执行迁移，保存时写入当前 schema
- 读取高于当前支持版本的 schema 时不得猜测解析，应提示升级应用
- 没有 `schemaVersion` 的早期配置视为 legacy 配置，按 schema 1 兼容读取并在下次保存时升级

## 合规规则版本

以下变化需要更新 `RULES_VERSION`，格式使用 `YYYY.MM`；同月多次变化可使用 `YYYY.MM.N`：

- 申报规则或审查口径变化
- 新增、删除或改变校验项
- 改变 fail/warn/pass 判定
- 改变分页、截取、页眉或文档格式规则

单纯修复 UI、性能或不影响结果的实现缺陷，不提升规则版本。每次导出结果和项目配置都应记录当时的规则版本。

## 分支与 Issue

- `main` 始终保持可测试、可构建
- 功能与修复使用短期分支，通过 PR 合入
- 当前不维护长期 `develop` 分支
- 每个计划发布版本对应一个 GitHub milestone，例如 `v0.1.0 — MVP`
- 所有 `release-blocker` issue 关闭后才能创建稳定版 tag
- `release/*` 分支只在需要同时维护多个已发布 minor 系列时启用

## CHANGELOG

所有用户可见变化记录在 `CHANGELOG.md` 的 `[Unreleased]` 下，分类使用：

- Added
- Changed
- Fixed
- Security
- Removed

发布时把 `[Unreleased]` 内容移动到带日期的版本标题：

```markdown
## [0.1.0] - 2026-07-22
```

tag 校验会拒绝缺少对应版本日期标题的发布。

## 发布流程

1. 确认目标 milestone 中所有 `release-blocker` 已关闭
2. 完成真实项目端到端验证与安装包验证
3. 确定 SemVer，执行 `npm run version:set -- <version>`
4. 整理 `CHANGELOG.md`，把 Unreleased 内容归入该版本和发布日期
5. 执行 `npm run verify`
6. 提交 `chore(release): v<version>`
7. 创建 annotated tag：`git tag -a v<version> -m "CodeSucker v<version>"`
8. 推送 main 与 tag；CI 再次校验 tag、版本和 CHANGELOG 一致
9. 由发布工作流生成安装包、校验和与 GitHub Release

在三平台打包流程落地前，第 9 步保持人工执行，不添加无法产出有效安装包的自动发布工作流。

## 当前版本

`0.1.0` 是当前 MVP 的目标版本，尚未因源码中的版本字段而自动视为正式发布。只有存在通过校验的 `v0.1.0` tag 和对应 GitHub Release 时，才表示该版本已正式发布。
