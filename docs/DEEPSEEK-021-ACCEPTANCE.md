# DeepSeek 0.2.1-rc.2 适配验收

日期：2026-10-19。插件版本：0.1.6。只支持 DeepSeek Harness 0.2.1-rc.2、Cordis 4.0.5、loader 1.0.6；无旧接口兼容层、数据库 migration 或旧版本 fallback。

## 实现与数据约束

- 官方核心依赖改由宿主提供，安装包不再向桌面 profile 安装另一套核心。插件自己的前端和业务依赖保留。
- 子任务使用新版 activation/provider 接口，保留一个公开预设及原有 OCR、知识检索、目录、正文角色。启动前绑定 childId，首步工具范围和目录写入约束即时生效。
- 停止会释放已接受的子任务；卸载先排空业务和会话，再释放 scope，避免会话提前关闭导致写入失败。
- 业务数据库结构、原件、成果和项目主会话绑定保持；原安装目录不变。续跑复用有效成果，不在重启时自动发起模型请求。
- 文件读取期间发生一次并发写入时重新读取，最多三次；持续变动仍报错，不缓存混合内容的指纹。

## 隔离验收

| 验证 | 结果 |
| --- | --- |
| TypeScript 检查、页面构建 | 通过 |
| JavaScript 完整回归 | 184/184，通过，0 跳过 |
| Python 完整业务回归 | 661/661，通过 |
| 独立目录安装、完整流程、更新及数据保留 | 23/23，通过 |
| 已安装真实 App 的 link 安装与宿主启动 | 9/9，通过 |
| 已安装真实 App 的正式 TGZ 安装与宿主启动 | 9/9，通过 |
| 独立实现复核 | PASS，无发布阻断 |

专门覆盖：父任务停止、子任务取消、插件卸载、SIGKILL 后重启、原始 0.2.0 合成任务续跑、问答继续、已有 DOCX 复用和导出、原始会话事件前缀与上游文件哈希保留。旧任务样本来自原始旧版宿主，测试只使用官方当前工作目录服务重定位临时副本，不改写旧事件或增加生产数据迁移。

真实 App 使用已签名客户端的 ASAR 和 Electron 44.7.0 / Node 24.21.0。17 个官方 peer 全部解析至 App，10 个动态组件为 ACTIVE；欢迎 RPC、业务列表、页面资源及完整关闭通过。TGZ 的 postinstall 自动准备 Python 3.13.13，临时 profile 中没有额外官方核心包。

隔离验收使用本机受控模型和合成材料，验证工程链路及数据恢复，不代表真实模型生成内容的质量审核，也未自动续跑任何实际客户任务。Windows/Linux 未做实机验收。

复验入口：`npm run check`、`npm run build`、`npm test`、`npm run test:business`、`node scripts/verify-delivery.mjs`、`node scripts/verify-desktop-host.mjs`、`node scripts/verify-desktop-host.mjs --package <tgz>`。

证据：[交付流程](evidence/deepseek-021-delivery-validation-20261019.json)、[真实 App link](evidence/deepseek-021-desktop-host-20261019.json)、[真实 App TGZ](evidence/deepseek-021-desktop-package-20261019.json)。完整回归日志保存在本机 `/tmp/bidv4-021-js-bounded-final.log` 和 `/tmp/bidv4-021-business-complete-final.log`。

## 正式安装注意

本地 TGZ 使用 pnpm 11 的精确文件 locator 批准插件自身的 Python 准备脚本。旧式仅按包名批准不能替代该 locator。不得批准不相关的包或把旧核心目录恢复进新版 profile。

正式更新前已退出客户端及原本地 Web 宿主，完整备份于 `/Users/ooo/Documents/AIwork/backups/DeepSeek-正式更新前-20261019-111602`。29,775 个文件及 547 个符号链接与源一致，业务 SQLite 完整性通过。完整备份包含凭据，只在本机保存，不进入交付包。

正式插件已在原路径更新到 0.1.6，使用上述真实 App 验收的同一 TGZ（SHA-256：`7cbbf207ad4262b1ccaac24bc7a908ab8db1cce2dc64eec66b21035232a7096d`）。旧 profile 的安装依赖和 lockfile 整体隔离留存，避免旧依赖图继续请求 0.1.5 或覆盖新宿主；新包由官方 CLI 原位安装。

安装前后 561 个业务文件、769 个会话文件、96 个附件和 331 个宿主存储文件逐项一致。App 启动后业务数据库全部表的内容哈希仍与备份一致；会话和附件仍一致。新版宿主刷新了一个可重建的会话投影缓存，原始会话事件没有变化。

正式界面确认原 2 个项目、14 份公司资料和原中断会话可读，任务仍保持停止。原独立 Web 服务也已使用新 SDK 恢复至 3080，保留其独立的 4 个项目，没有发起模型任务。

正式验收：[生产更新记录](evidence/deepseek-021-production-20261019.json)，`passed: true`。
