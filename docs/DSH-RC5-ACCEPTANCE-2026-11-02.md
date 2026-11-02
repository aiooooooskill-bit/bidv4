# DSH rc.5 交付修正验收

日期：2026-11-02。插件：0.1.13。目标：当前已安装的官方桌面 `0.2.1-rc.5`。

## 原因与修正

0.1.12 面向另一条 `0.2.2-alpha.2` 分支，发布前没有验证用户实际桌面宿主。官方 rc.5 发布时间为 10 月 30 日，alpha.2 为 10 月 28 日，不能仅按数字较大判断用户安装了哪个分支。当前 App 的 Info.plist 与 ASAR 内置 SDK 均为 rc.5，原始安装器正确拒绝 0.1.12，并回滚安装树。

直接放宽 engines/peer 会继续失败：该 ASAR 没有 `dsh-tool-executor-native`，也没有 `AgentModel`；其官方实现提供 `tools.presentAs('native')`、单工具 `tools.execute()`，控制器持有待选模型投影且 Agent options 可写。0.1.13 仅对接 rc.5 版本线，不打补丁、不增加兼容或 fallback。

- engines、DSH peers 与 doctor：`>=0.2.1-rc.5 <0.2.2-0`。
- 开发 SDK：全部 `0.2.1-rc.5`，Cordis `4.0.5`，loader `1.0.6`；Node.js 24.9+、Python 3.12+。
- 目录冻结与差异诊断、原生 UI 会话覆盖、问题投影、压缩、子任务、数据保留及卸载清理保持回归覆盖。

## 验证结果

完整回归通过，记录见 [发行记录](evidence/release-0.1.13-validation.json)。

| 检查 | 结果 |
| --- | --- |
| TypeScript / 构建 | 通过 |
| JavaScript 全量 | 274 项通过，0 失败、0 跳过 |
| Python 全量 | 871 项通过 |
| 独立交付生命周期 | 23 阶段通过 |
| 当前 App 原始 ASAR 隔离目录安装及启动 | 9 阶段通过 |
| SDK 与 App 的工具、Agent、会话控制器实现 | 三个关键模块逐字节一致 |

App 为 DSH `0.2.1-rc.5` / Electron `44.7.0` / 内置 Node `24.21.0`。SDK 回归与最终本地源码逐字节核对一致；合入后再次通过接口定向检查。最终归档哈希与 TGZ 的官方桌面安装/启动验收在打包后记录于 GitHub Release 的 `validation.json`，避免自引用哈希。

## 发布检查

发布之前必须使用用户实际桌面 App 运行 `npm run verify:desktop -- --package /absolute/path/to/final.tgz --report /absolute/path/to/report.json`；仅 SDK 测试和解压准备不能替代官方桌面安装。该脚本使用独立 DSH_HOME、profile、凭证目录和业务数据，官方 CLI 安装后启动真实 desktop-host，验证预设、组件及业务/页面资源，并等待完整关闭。完成后清理隔离副本和服务，保留结果日志。

本次不会修改正在使用的桌面 profile、模型凭证或正式业务数据。macOS arm64 实机验证不代表 Windows/Linux 实机已通过；确定性模型用于验证工程链路，不评价真实模型标书内容质量。
