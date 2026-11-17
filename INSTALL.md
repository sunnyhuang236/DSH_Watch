# DSH Watch 安装说明（给别人看）

目标：普通 Windows 用户下载后，**双击两次**完成安装和启动，不需要看代码。

---

## 一、准备

对方电脑需要：

1. **Node.js 24 LTS**  
   下载：https://nodejs.org/  
   安装后确认：打开 PowerShell，输入 `node --version`，能显示版本号。

2. **DSH Desktop**  
   安装后至少启动一次，并确认 DSH 能正常打开。

3. **cloudflared（可选，但手机远程访问需要）**  
   在 PowerShell 里运行：

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

   或把 `cloudflared.exe` 放到项目目录的 `.data\bin\cloudflared.exe`。

> 不需要 Apple 开发者账号；PWA 使用 Web Push，零成本。M3 原生 IPA 是可选展示项。

---

## 二、下载项目

GitHub 仓库：

**https://github.com/sunnyhuang236/DSH_Watch**

推荐方式：打开链接 → 绿色 **Code** 按钮 → **Download ZIP** → 解压。

解压后应看到：

```text
DSH_Watch-main\
├─ install.cmd
├─ start-dsh-watch.cmd
├─ install-dsh-watch.ps1
├─ packages\
├─ apps\
└─ docs\
```

如果你拿到的是本机项目文件夹，入口在：

```text
dsh-mobile-watch\install.cmd
```

---

## 三、安装（第一次）

### 第 1 步：双击 `install.cmd`

它会自动：

- 检查 Node.js 和 DSH；
- 安装 `packages/gateway` 依赖；
- 运行测试（当前 74/74）；
- 把 `dsh-watch` 插件安装到 DSH 的 `desktop` profile。

看到 **“安装完成”** 后继续。

> 如果 DSH 使用的是 Web profile，在项目目录打开 PowerShell，运行：
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install-dsh-watch.ps1 -Profile web
> ```

### 第 2 步：重启 DSH Desktop

完全关闭 DSH，再重新打开。插件需要重启后才会加载。

---

## 四、启动和配对手机

### 第 3 步：双击 `start-dsh-watch.cmd`

它会自动：

1. 启动网关（`127.0.0.1:8787`）；
2. 启动 cloudflared tunnel；
3. 运行手机配对助手。

终端会显示：

- 手机配对地址（`https://xxxx.trycloudflare.com`）；
- 8 位配对码；
- 二维码（终端里）。

### 第 4 步：手机设置

1. iPhone Safari 打开终端显示的 **tunnel 地址**；
2. 点“分享”→“添加到主屏幕”；
3. **从主屏幕新图标打开**（不要只在 Safari 标签页里用）；
4. 输入 8 位配对码；
5. 在“设置”页开启通知，并允许 iOS 通知权限。

配对成功后，手机任务页会显示电脑上的 DSH 任务。

---

## 五、装完怎么用

打开手机主屏幕的 **DSH Watch**：

- **任务页**：查看运行中 / 等待审批 / 等待回答 / 完成 / 失败任务；
- 点任务进详情：看时间、来源、子代理、费用、轨迹；
- 出现审批卡：选择“允许一次”或“拒绝”；
- 出现问答卡：选择答案并提交；
- **提醒页**：查看完成/失败/等待通知记录；
- **设置页**：开关通知、查看配对状态。

完整图文说明见：

- `docs/USER-GUIDE.md`

---

## 六、常见问题

| 问题 | 处理 |
| --- | --- |
| 双击 `install.cmd` 闪退 | 右键“以 PowerShell 运行”，或打开 PowerShell 执行 `powershell -ExecutionPolicy Bypass -File .\install-dsh-watch.ps1`，看报错 |
| 提示找不到 DSH | 先安装并启动一次 DSH Desktop；或确认 `dsh.cmd` 路径 |
| 提示 Node 不存在 | 安装 Node.js 24 LTS，重新打开 PowerShell |
| 手机打不开地址 | cloudflared 是否启动；重新双击 `start-dsh-watch.cmd`，tunnel 地址会变化 |
| 通知收不到 | 必须从主屏幕图标打开、开启通知权限；确认 `subscriptions` 不为 0 |
| 审批后电脑还显示等待 | DSH 桌面客户端没有跨端广播，刷新/切换会话即可，手机决定已生效 |
| 费用显示“暂无数据” | DSH 当前只提供 token，不提供费用字段，这是预期行为 |

---

## 七、给 DeepSeek / AI 的安装提示词

把下面整段复制给 AI：

```text
项目：https://github.com/sunnyhuang236/DSH_Watch
请先完整阅读 docs/AI-DEPLOY.md、docs/DEPLOYMENT.md 和 docs/USER-GUIDE.md。

任务：在这台 Windows 电脑上部署 DSH Watch。
要求：
1. 不要修改 DSH 源码、不要碰 ui-theme 或任何 UI 插件；
2. 不要读取、打印或上传任何凭证；
3. 优先使用项目根目录的 install.cmd / install-dsh-watch.ps1 完成依赖、测试和 dsh-watch 插件安装；
4. 重启 DSH 后，用 start-dsh-watch.cmd 启动网关 + tunnel + 配对；
5. 按 docs/USER-GUIDE.md 教用户完成手机主屏幕安装、通知授权和基本使用；
6. 遇到不确定的系统安装或权限变更，先询问用户，不要绕过安全设置。
```

---

## 八、安全提醒

- tunnel 地址和配对码只发给自己的手机，不要发群或公开；
- 配对码 5 分钟有效，过期重新生成；
- 不使用时可以关闭 `start-dsh-watch.cmd` 启动的窗口，停止 tunnel；
- 不要共享 `.dsh`、`state.json`、设备 token 或任何 API key；
- 本项目不修改 DSH 源码，也不修改 `ui-theme` 等 UI 插件。
