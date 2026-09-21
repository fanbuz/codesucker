# CodeSucker 版本与发布规范

本文是 CodeSucker 产品版本、配置兼容、规则追踪和 Git 发布的唯一标准。README 只保留摘要；发生冲突时以本文和自动校验脚本为准。

## 版本维度

| 版本 | 示例 | 用途 | 来源 |
|---|---|---|---|
| 产品版本 | `0.1.0` | 用户看到的应用与安装包版本 | 三个 `package.json`，由脚本同步 |
| 构建版本 | Git SHA / Actions run number | 定位同一产品版本的具体构建 | CI 环境，不写回源码 |
| 配置结构版本 | `1` | 迁移 `.codesucker.json` | `CONFIG_SCHEMA_VERSION` |
| 合规规则版本 | `2026.07.2` | 追踪生成时采用的校验规则口径 | `RULES_VERSION` |

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

`verify` 会依次执行版本一致性校验、lockfile 公共源检查、品牌图标生成资产一致性校验、第三方许可证策略与归属清单校验、测试和完整构建。lockfile 中出现非公共依赖下载地址时必须失败，且检查日志不得回显具体地址。

## 配置结构版本

新保存的 `.codesucker.json` 必须包含：

```json
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "rulesVersion": "2026.07.2"
}
```

变更规则：

- 新增可选字段且旧版本可安全忽略：不提升 schema
- 删除、改名、改变字段类型或语义：提升 schema
- 读取低版本 schema 时执行迁移，保存时写入当前 schema
- 读取高于当前支持版本的 schema 时不得猜测解析，应提示升级应用
- 没有 `schemaVersion` 的早期配置视为 legacy 配置，按 schema 1 兼容读取并在下次保存时升级

读取和保存共用字段白名单。未知字段丢弃；错误类型退回默认值；文件顺序和排除列表只保留扫描到的相对路径并去重；清洗开关逐项补默认值，同时保留有效的 `false`。用户选择的工程外导出目录仍然有效。未来 schema 只提示升级，保存时也拒绝覆盖。

配置文件只接受普通文件，拒绝符号链接、目录或设备。保存使用同目录独占临时文件，写入并同步后原子替换，POSIX 平台还会同步父目录。替换前失败保留原配置并清理本次临时文件；替换后目录同步失败会明确提示“已替换，但持久性未确认”。Windows 不额外承诺断电持久性。SIGKILL 或断电可能留下独占临时文件，应用不会扫描并删除未知残留。


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

## Actions 验证与打包

| 触发方式 | 工作流 | 执行内容 |
| --- | --- | --- |
| PR 创建、重新打开、推送修复提交 | `Verify` | 工作流语法检查、版本/许可证检查、测试、构建和 worker 集成验证 |
| 推送到 `main` | `Verify` | 验证合并后的代码 |
| 手动运行 | `Package and Release` | 一次完整验证、三平台安装包和 Windows 启动冒烟；不发布 Release |
| 推送 `v*` 标签 | `Package and Release` | 标签校验、一次完整验证、三平台打包、校验和与 GitHub Release |

普通 PR 不生成安装包。单独提交 `@codex` 审核评论不会触发这两个工作流；审核后的修复提交会重新运行 `Verify`。CI 的旧运行会被同一 PR 的新运行取消。

涉及 Electron、依赖、安装器、平台行为或工作流的改动，应在合并前手动生成测试包并完成相关平台验证：

1. 打开 GitHub → Actions → `Package and Release` → `Run workflow`。
2. 选择待验收分支，并确认该分支最新提交就是本次验收目标。工作流文件须已存在于默认分支；新策略首次合入前应先完成本地校验。
3. 运行成功后，在该次运行的 Artifacts 中下载 `codesucker-macos-x64`、`codesucker-macos-arm64`、`codesucker-windows-x64`。
4. 将运行链接、提交 SHA 和安装验证结果记录到 PR；随后若修改影响打包或运行的内容，需要重新验收。

也可以通过 CLI 指定仓库和分支：

```bash
gh workflow run release.yml --repo fanbuz/codesucker --ref <branch>
```

手动生成的安装包保留 3 天，只用于验收，不代表已经发布；即使手动选择版本标签，也不会创建 GitHub Release。同一 ref 的手动重复运行会取消旧运行。正式标签发布与手动打包使用独立并发组，不会互相取消；标签构建产物保留 7 天，已发布的 Release 附件不受这个期限影响。

`Verify` 使用固定版本 actionlint 检查工作流。`npm run verify` 已包含许可证检查，因此发布工作流不再建立独立的重复许可证任务。将来启用 PR 必需检查时，应选择 `Verify` 的 `verify` 任务，不将手动打包任务设为所有 PR 的必需条件。

## 发布流程

1. 确认目标 milestone 中所有 `release-blocker` 已关闭
2. 完成真实项目端到端验证与安装包验证
3. 确定 SemVer，执行 `npm run version:set -- <version>`
4. 整理 `CHANGELOG.md`，把 Unreleased 内容归入该版本和发布日期
5. 执行 `npm run verify`
6. 提交 `chore(release): v<version>`
7. 创建 annotated tag：`git tag -a v<version> -m "CodeSucker v<version>"`
8. 推送 main 与 tag；`Verify` 验证 main，标签只触发 `Package and Release`，先校验 tag、版本和 CHANGELOG 一致再安装依赖和运行完整验证
9. 验证通过后，`Package and Release` 生成 macOS x64、macOS arm64、Windows x64 安装包与 SHA-256 校验文件，并创建 GitHub Release；预发布标签生成 pre-release

当前发布流程暂不产出 Linux 安装包；macOS 安装包未签名、未公证，必须在 Release 说明和 README 中保留 Gatekeeper 指引。正式签名凭据只能存放在 GitHub Secrets，不得写入仓库或构建日志。

## 当前版本

源码当前产品版本为 `0.5.2`。正式发布以 `v0.5.2` tag 和对应 GitHub Release 为准；仅修改源码中的版本字段不代表已经发布。
