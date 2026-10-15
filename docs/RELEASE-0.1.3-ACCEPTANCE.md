# 0.1.3 完整插件修订版验收

日期：2026-10-15。修复 0.1.2 发布后在桌面客户端清理重装时发现的运行依赖缺失：autoInstallPeers=false 的宿主 profile 不会安装仅声明为 peer 的包。Agent 预设、React 和 React DOM 现明确声明为固定版本的运行依赖。

本次包含上下文压缩修复与 Windows 适配；计划文档及其他任务尚未定稿的资料库改动不提交。源码对应 v0.1.3，完整 TGZ 与 ZIP 使用相同文件集合。

**Windows 实机尚未验证，Linux 也未进行实机验收。** 已按用户要求先发布修复包。macOS 上，合并实现全量 Node 145 项、Python 544 项、官方安装生命周期23项通过，见0.1.2对应日志；本次依赖修订后类型检查、平台/交付10项与真实TGZ的全新环境安装再次通过。实际包在中文和空格路径中准备、构建、自检、创建中文项目、读取28个工具均成功，见[压缩包安装报告](evidence/cross-platform-package.json)。

完整包包含 DSH Agent 预设、原生 Chat、页面及前后端、PDF/图表资源、Python业务工具、技能、角色、模板、固定依赖和安装脚本。排除用户数据、凭证、缓存、备份、本机 Node/Python 环境。模型相关回归采用本机确定性夹具。

客户端选择“压缩包”安装源：

```text
https://github.com/aiooooooskill-bit/bidv4/releases/download/v0.1.3/ooo-bidpliot-0.1.3.tgz
```

要求 Node.js24+、Python3.12+、uv 和 DSH0.2.0-rc.2。宿主内置 pnpm11.7.0 的 URL 缓存和任务不退出问题仍按0.1.1历史记录处理，插件升级不保证修复宿主安装器。

## 发布后下载与本机桌面客户端

三个附件已通过公开下载地址重新下载，与本地文件逐字节相同且符合 GitHub digest；TGZ/ZIP 的601个文件逐字节一致。见[附件校验](evidence/release-0.1.3-github.json)。

先关闭本机客户端、备份原插件数据，再通过官方包管理函数移除旧插件并使用本版本 GitHub TGZ 地址安装。桌面 profile 只有 ooo-bidpliot 一个第三方插件，依赖地址精确指向 GitHub v0.1.3；旧项目数据已恢复，601个安装文件均与发布附件一致。Node/Python环境与所有依赖自检通过。见[安装报告](evidence/release-0.1.3-desktop.json)。

重新打开实际客户端后，详情显示 **v0.1.3、1个组件运行中**；工作台页面可打开，原项目保留，新会话的 Agent 预设菜单包含 ooo-bidpliot。见[版本截图](evidence/release-0.1.3/desktop-version.png)与[预设截图](evidence/release-0.1.3/desktop-agent.png)。未调用真实模型。

本次安装调用已安装 DSH 的官方 runPlugin('desktop', …) 和系统 pnpm11.25.0，没有改成本地目录安装。初次网络请求 ECONNRESET，重试同一 GitHub 地址后成功；客户端内置 pnpm11.7.0 的界面安装任务问题没有重新宣称修复。客户端实际加载验证来自本机 macOS，**仍不代表 Windows 实机通过**。
