# 第三方代码风险提示说明

CodeSucker 0.5.0 的第三方代码风险提示用于帮助用户发现“可能不应直接纳入软著源程序材料”的文件。分析全程在本机完成，不执行包管理器，不访问远程仓库，也不会上传源码、文件摘要、依赖清单或项目路径。

## 结果含义

每条提示包含稳定规则 ID、证据来源、证据匹配置信度、受影响的项目相对路径和建议动作。置信度描述的是“本地证据是否匹配明确”，不是著作权归属、违法程度或法律风险等级。

- **高置信**：依赖清单名称与常见第三方目录路径相互印证，或源码注释含明确生成标记。
- **中置信**：命中 vendor/generated 等目录或普通署名、许可证文字，但缺少第二项独立证据。
- **低置信**：只存在需要人工核验的弱声明。首版不会据此自动排除文件。

CodeSucker 只提示和推荐操作。用户点击“按建议取消勾选”时，仍是修改现有文件选择；点击“确认仍然纳入”只记录本规则版本下的确认。规则版本变化后旧确认会失效，避免证据变化后继续静默沿用。

## 首批本地清单支持

| 生态 | 支持内容 | 保守边界 |
|---|---|---|
| Node.js | `package.json`，`package-lock.json` v1–v3 | `workspace:`、`file:`、`link:` 和项目内相对路径按本地依赖处理；pnpm/yarn 锁文件暂不解析 |
| Java / Kotlin | `pom.xml` 静态 dependency/module，Gradle Groovy/KTS 字面量依赖，`gradle.lockfile` | 不执行 Gradle，不求值变量、插件或父 POM；动态声明只产生“分析不完整”诊断 |
| Go | `go.mod` 的 module/require/replace，`go.work`，`vendor/modules.txt` | replace 到项目内路径按本地依赖处理；不执行 `go list` |
| Rust | `Cargo.toml` 静态 dependency/path 声明，`Cargo.lock` | workspace/path 依赖按本地代码处理；不执行 Cargo |
| Python | `requirements*.txt`、`pyproject.toml`、Poetry/Pipenv/uv 锁文件的静态字段 | editable/path 依赖按本地代码处理；发行名和 import 包名并不总能可靠对应 |

普通清单最大读取 8 MiB，锁文件最大读取 32 MiB，最多分析 512 个清单和 10,000 个源码文件头。超过预算、格式损坏或动态声明不会中止扫描，而会生成单独诊断，提醒用户手工核验。

## 其他本地证据

- 第三方目录只匹配完整目录段：`vendor`、`vendors`、`vendored`、`third_party`、`third-party`、`thirdparty`、`external`、`externals`、`deps`。
- 生成目录只匹配：`generated`、`gen`、`autogen`、`generated-sources`；同时识别常见生成文件名和注释标记。
- SPDX、许可证文字、`@author` 和 `Copyright` 仅在真实源码注释中识别；字符串中的示例文本不会命中。
- 每个源码文件只读取开头 32 KiB 作为头部证据，不把原始许可证行或署名行写入风险报告。

## 导出摘要与隐私

导出 DOCX/TXT 时会同时生成 `第三方代码风险摘要_<软件名>.json`。主进程根据本次可信扫描报告、最终纳入文件列表和有效用户确认动态计算每条提示的处理状态：

- `excluded`：受影响文件全部未纳入；
- `partially-excluded`：仅部分受影响文件未纳入；
- `kept-by-user`：全部仍纳入，且用户已明确确认；
- `pending`：全部仍纳入，尚未确认。

摘要不包含源码正文、原始证据行、文件内容哈希或项目绝对路径，也不会改变软著 DOCX/TXT 的正文格式。

## 已知盲区

- 删除许可证、改名或深度改写后的复制源码不一定能识别。
- 依赖清单只证明“项目使用依赖”，不能单独证明某个源码文件来自该依赖。
- vendor 目录也可能保存自研代码；generated 文件也可能由团队自研工具生成并合法持有权利。
- 根目录 LICENSE/NOTICE 不会让整个项目被判为第三方；项目自身 SPDX 或署名仍可能产生“请核验”的声明提示。
- 本功能不替代 SBOM、漏洞扫描、开源许可证审计、授权文件核验或专业法律意见。
