# M4 拒绝/冲突安全测试方案

日期：2026-11-15｜状态：**设计稿（未执行）**｜适用版本：DSH 0.2.2-rc.3 / `dsh-watch` 0.1.0 / M2 网关

## 0. 目标与结论

本方案补齐 M4-A 报告 §5 待验证项中的 #1 与 #3：

1. **桌面先允许 → 手机 conflict**（M4-A #1）：电脑端先点「允许一次」，手机基于旧卡片再提交，应得到 `409 conflict`，且工具只执行一次、手机提交不产生第二次执行；
2. **手机 PWA 拒绝**（M4-A #3）：手机点「拒绝」后，DSH 工具不得执行，action 应为 `status=decided`、`decision=mobile`、`outcome=rejected`。

推荐做法：**不碰当前主 profile**，新建一个独立的测试 profile `m4-edge`（从 `web` 模板初始化），该 profile 不包含 `@deepseek-ai/dsh-experimental-auto-review`；同时把测试会话存储、`dsh-watch` 数据库、网关 state 和端口全部隔离。这样既关闭了 auto-review 的影响，又不需要改动当前 `desktop` profile 或任何 UI 插件。

> 术语说明：本文中的「桌面」指**电脑浏览器里的测试 DSH Web UI（`http://127.0.0.1:18080`）**，不是正在运行的 DSH Desktop 主应用；「手机」指与测试网关 18787 配对的 iPhone Safari/PWA 页面。

### 0.1 通过标准（总览）

| 用例 | 关键结果 |
| --- | --- |
| M4E-REJECT-01 手机拒绝 | action：`decided / mobile / rejected`；工具 body 未执行；测试标记文件不存在 |
| M4E-CONFLICT-01 桌面先允许→手机 conflict | 桌面：`resolved / desktop / allowed-once`；手机：HTTP 409 `status=conflict`、`current_status=resolved`、`current_decision=desktop`；测试日志只有 1 行 |
| 安全验收 | 主 `desktop` profile 三个文件哈希与测试前一致；主插件 7317 与主网关 8787 健康；没有任何 `ui-theme`/UI 插件被改动 |

## 1. 安全边界（先读）

### 1.1 明确不做的事

- **不修改** `C:\Users\22472\.dsh\profiles\desktop\` 下的任何文件；不使用 `plugin_manager` 操作主 profile；
- **不安装、不卸载、不修改** `ui-theme` 或任何 UI 插件；
- **不在主 profile 中关闭 auto-review**。当前 desktop profile 的 `package.json` 已包含 `@deepseek-ai/dsh-experimental-auto-review`；按 DSH 升级指南，运行中移除该插件会把存活的 Auto 会话迁移到 Full access，属于会影响当前使用的变更。正确做法是使用一个**从 `web` 模板新建、没有该 bundle 的测试 profile**；
- **不把 approval policy 设为 `never`**：DSH 的 `never` 在 waterfall 分发**之前**就返回 `rejected`，不会产生 pending approval；`danger-full-access` 预设对应的正是 `never`，也不可用于本测试；
- **不把测试网关暴露到公网**：不启动 cloudflared/tunnel；测试期间网关只绑定局域网地址，手机与电脑在同一 Wi-Fi；
- **不写测试 workspace 之外的文件**：唯一允许的工具写操作是临时 workspace 内的 `probe-*.txt` / `probe-*.log`；
- **不复制、不打印任何凭证**：测试 profile 复用现有 DSH home 的 provider 配置（`~/.dsh/cordis.patch.yml` 的 Magpie provider），不读取 `.credentials.yaml`。

### 1.2 auto-review 的安全边界

当前 desktop profile 带有 `@deepseek-ai/dsh-experimental-auto-review`。如果会话选中「自动审查（Auto）」预设：

- 低风险动作可能被自动允许，不会出现人工审批；
- 中风险被拒绝后才转为审批，时序和是否出现 pending 取决于 reviewer 模型，不可重复；
- 每次工具调用额外产生一次 reviewer 模型请求与 token 消耗。

因此本测试使用 `web` 模板新建的 `m4-edge` profile。`web` 模板的 bundle 只有 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`，**不包含 auto-review**；测试会话的权限选择器里不应出现「自动审查/Auto」选项。

验证命令见 §4.4。若 `--dump-config` 输出出现 `auto-review`，停止测试并修正 profile，不能继续。

## 2. 测试环境设计

### 2.1 目录与端口

| 项目 | 值 | 说明 |
| --- | --- | --- |
| DSH home | `C:\Users\22472\.dsh`（现有，不修改） | 复用 provider 凭证与 home patch；不新建/复制凭证 |
| 测试 profile | `C:\Users\22472\.dsh\profiles\m4-edge` | 独立 profile，可安全删除 |
| 测试根目录 | `C:\Users\22472\AppData\Local\Temp\dsh-m4-edge` | 所有测试数据只在这里 |
| 测试 workspace | `...\dsh-m4-edge\workspace` | 只允许在这里写 `probe-*` |
| 测试会话存储 | `...\dsh-m4-edge\sessions` | 覆盖 `session-persistence-jsonl.root`，不写主 `~/.dsh/sessions` |
| 测试 `dsh-watch` DB | `...\dsh-m4-edge\watch.db` | 不写主 `~/.dsh/dsh-watch/watch.db` |
| 测试网关 state | `...\dsh-m4-edge\gateway-state.json` | 不复用主网关设备 token |
| 测试 DSH Web UI | `http://127.0.0.1:18080` | PC 浏览器打开 |
| 测试 `dsh-watch` API | `http://127.0.0.1:17317` | 只监听 loopback |
| 测试网关/PWA | `http://<PC_LAN_IP>:18787` | 只给同一局域网的手机 |
| 主 `dsh-watch` API | `http://127.0.0.1:7317` | 不碰、只做健康对比 |
| 主网关 | `http://127.0.0.1:8787` | 不碰、只做健康对比 |

### 2.2 数据流

```text
iPhone Safari/PWA
  └─ http://<PC_LAN_IP>:18787  (测试网关，设备 Bearer token)
       └─ 反向代理 /v1/actions* → http://127.0.0.1:17317 (测试 dsh-watch 插件)
            └─ 测试 DSH 实例（profile=m4-edge，Web UI 127.0.0.1:18080）
                 └─ 审批桥 ApprovalBridge → DSH approval/request waterfall
```

主 DSH 实例、主插件 7317、主网关 8787 不在这条链路中。

### 2.3 为什么这是「等价安全沙箱」

- **进程/配置隔离**：测试实例是独立 DSH 进程、独立 profile 配置层、独立端口、独立插件数据库、独立网关 state；主 profile 文件没有任何写入路径（home 级 patch 只读继承）；
- **会话隔离**：`session-persistence-jsonl.root` 指到临时目录，测试会话不写入 `~/.dsh/sessions`；
- **权限隔离**：测试 profile 没有 auto-review；默认 base 配置是 `workspace-write + ask`，测试会话使用 `read-only` 预设，只会在用户点击「允许」后才升权；
- **桌面端等价性**：测试 Web UI 与 DSH Desktop 审批卡复用同一个 `@deepseek-ai/dsh-client-ui-approval` client 插件；本方案用测试 Web UI 作为「桌面」端，避免触碰主 Desktop profile；
- **数据最小化**：测试工具只写临时 workspace 的两个固定文件，不碰仓库源码、不读取凭证、不访问外网；
- **可清理**：删除 `m4-edge` profile 与 `%TEMP%\dsh-m4-edge` 即可回滚。

## 3. 需要用户确认的步骤

> 执行前请逐项确认；任何一项不满足都不要开始。测试期间的 PC「允许一次/拒绝」与手机「允许一次/拒绝」都必须由用户本人点击；本方案不代替用户做审批决定。

| ID | 确认项 | 如何确认 | 不满足时 |
| --- | --- | --- | --- |
| U1 | 同意新建独立 profile `m4-edge`，不改动 `desktop` profile | 看完 §2.3；确认 `~/.dsh/profiles/desktop` 的 `package.json`、`cordis.patch.yml`、`pnpm-lock.yaml` 备份/哈希已记录 | 停止，不执行 |
| U2 | 同意测试数据只放在 `%LOCALAPPDATA%\Temp\dsh-m4-edge` | 确认该目录当前不存在或可删除 | 换一个新临时目录并同步本文路径 |
| U3 | 确认端口 `18080`、`17317`、`18787` 未被占用 | 执行 §4.1 端口检查 | 换端口并记录 |
| U4 | 确认手机与电脑在同一 Wi-Fi、无 AP 隔离，且测试期间不启动公网隧道 | 手机可访问电脑局域网 IP；Windows 防火墙允许 Node 私有网络入站 | 先解决网络；不要用隧道替代 |
| U5 | 确认测试实例可使用现有 Magpie provider（模型 `group/ds-flash-wkbd`）并接受极少量测试 token 消耗 | 主 DSH 当前使用同一 provider；测试 profile 继承 `~/.dsh/cordis.patch.yml` | 在测试 profile 的 patch 中改 provider/model，或使用已有可用模型 |
| U6 | 确认测试 profile 不包含 `@deepseek-ai/dsh-experimental-auto-review`，权限选择器无「自动审查」 | §4.4 的 `--dump-config` 检查 | 停止，重建 `m4-edge` |
| U7 | 确认不安装/不修改 `ui-theme` 及任何 UI 插件 | 只执行本方案命令；`m4-edge/package.json` 不应出现 UI 插件 | 停止并检查 |
| U8 | 确认测试会话存储、watch DB、网关 state 都在临时目录 | §4.4 配置检查 | 停止，修正 patch |
| U9 | 确认测试工具只会写 `probe-reject.txt` / `probe-conflict.log` 两个临时文件 | 使用 §5 的固定 prompt；不运行其他 agent 任务 | 不执行测试 |
| U10 | 确认测试后的清理与回滚步骤（§8）可接受 | 确认可删除 `m4-edge` profile 和临时目录；主 desktop profile 不做任何删除 | 不执行 |

**用户签字/确认**：姓名/日期：____________；已确认 U1–U10：是 / 否。

## 4. 环境准备步骤（用户执行）

### 4.1 预检：主 profile 基线、端口、版本

在 PowerShell 里执行：

```powershell
$Dsh = 'D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$TestRoot = Join-Path $env:LOCALAPPDATA 'Temp\dsh-m4-edge'
$MainProfile = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'

# 版本必须是 0.2.2-rc.3
& $Dsh --version

# 记录主 profile 三个文件的哈希（测试后对比）
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
$before = Get-FileHash "$MainProfile\package.json", "$MainProfile\cordis.patch.yml", "$MainProfile\pnpm-lock.yaml" -Algorithm SHA256
$before | ConvertTo-Json | Set-Content "$TestRoot\main-profile-before.json" -Encoding utf8
$before | Format-Table Path, Hash -AutoSize

# 端口检查：三项都应打印 free
foreach ($port in 18080, 17317, 18787) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($listener) { Write-Host "PORT $port IN USE pid=$($listener.OwningProcess)" } else { Write-Host "PORT $port free" }
}

# 测试过程中不要继承 danger-full-access
Remove-Item Env:DSH_PERMISSION_MODE -ErrorAction SilentlyContinue
```

> 默认方案共享现有 `~/.dsh`，目的是复用 provider 配置与凭证。如果启动第二个实例时遇到 home 级 storage/lock 冲突，可退化为完全隔离：`$env:DSH_HOME = "$TestRoot\home"`，同时把 `~/.dsh/cordis.patch.yml` 里的 `llm-pi-ai` provider 配置复制到 `m4-edge` 的 `cordis.patch.yml`，并在启动终端设置 `MAGPIE_API_KEY`；不要复制 `.credentials.yaml`。发生这种退化时，测试 profile 路径也要改为 `$TestRoot\home\profiles\m4-edge`。

### 4.2 创建 `m4-edge` profile（只做一次）

```powershell
& $Dsh --profile m4-edge --from-default-profile web --dump-config |
  Out-File "$TestRoot\m4-edge-default-config.txt" -Encoding utf8
```

检查：

```powershell
Select-String -Path "$TestRoot\m4-edge-default-config.txt" -Pattern 'dsh-base|dsh-web-app' |
  Select-Object -First 10
# 必须没有 auto-review
Select-String -Path "$TestRoot\m4-edge-default-config.txt" -Pattern 'auto-review'
# 期望：无输出
```

> `--from-default-profile` 是**替换式**初始化；后续查看配置不要再次带该参数，避免覆盖 `m4-edge` 的 patch 和依赖。

### 4.3 安装本地 `dsh-watch` 插件

```powershell
& $Dsh plugin --profile m4-edge add `
  'file:C:/Users/22472/Desktop/DSH提醒小助手/dsh-mobile-watch/packages/dsh-watch'
```

检查 `C:\Users\22472\.dsh\profiles\m4-edge\package.json`：

- `dependencies` 中有 `"dsh-watch": "file:C:/Users/22472/Desktop/DSH提醒小助手/dsh-mobile-watch/packages/dsh-watch"`；
- `dsh.profile.bundles` 中有 `"dsh-watch"`；
- 不应出现 `ui-theme` 或其他 UI 插件。

### 4.4 写入测试 profile 的 `cordis.patch.yml`

编辑 `C:\Users\22472\.dsh\profiles\m4-edge\cordis.patch.yml`，内容如下（只改测试 profile）：

```yaml
# m4-edge 测试 profile 专用 patch；不要复制到 desktop profile。
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: magpie
    model: group/ds-flash-wkbd
    reasoningEffort: max

# 测试会话只写入临时目录，不写主 ~/.dsh/sessions
- id: session-persistence-jsonl
  name: "@deepseek-ai/dsh-session-persistence-jsonl"
  config:
    root: "C:/Users/22472/AppData/Local/Temp/dsh-m4-edge/sessions"

# 测试插件使用独立端口与独立 SQLite 库
- id: dsh-watch
  name: dsh-watch
  config:
    port: 17317
    host: 127.0.0.1
    db: "C:/Users/22472/AppData/Local/Temp/dsh-m4-edge/watch.db"
```

然后做组合检查：

```powershell
$dump = & $Dsh --profile m4-edge --dump-config
$dump | Out-File "$TestRoot\m4-edge-config.txt" -Encoding utf8

if ($dump -match 'auto-review') { throw 'FAIL: auto-review 出现在 m4-edge，停止测试' }
if ($dump -notmatch '17317') { throw 'FAIL: dsh-watch 端口未生效' }
if ($dump -notmatch 'dsh-m4-edge') { throw 'FAIL: 测试路径未生效' }

# 不应对主 profile 做任何 plugin 操作；确认测试 profile 的 manifest
Get-Content "$env:USERPROFILE\.dsh\profiles\m4-edge\package.json"
```

### 4.5 启动测试 DSH Web UI

新建一个专用 PowerShell 窗口（保持运行）：

```powershell
$Dsh = 'D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$TestRoot = Join-Path $env:LOCALAPPDATA 'Temp\dsh-m4-edge'
Remove-Item Env:DSH_PERMISSION_MODE -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$TestRoot\workspace" -Force | Out-Null
& $Dsh --profile m4-edge --port 18080 --no-open
```

另开一个窗口检查测试插件（若刚启动，等待 2–3 秒再重试一次）：

```powershell
Invoke-RestMethod http://127.0.0.1:17317/v1/health | ConvertTo-Json -Depth 5
# 期望：ok=true，contract=m1-v1.1，capabilities.approval=true
```

### 4.6 启动测试网关并配对手机

先确认网关依赖已安装（首次）：

```powershell
Set-Location 'C:\Users\22472\Desktop\DSH提醒小助手\dsh-mobile-watch\packages\gateway'
if (-not (Test-Path 'node_modules\web-push')) { npm install --prefix . }
```

启动测试网关（专用窗口，保持运行）：

```powershell
Set-Location 'C:\Users\22472\Desktop\DSH提醒小助手\dsh-mobile-watch\packages\gateway'
$TestRoot = Join-Path $env:LOCALAPPDATA 'Temp\dsh-m4-edge'
node bin/gateway.mjs `
  --host 0.0.0.0 `
  --port 18787 `
  --upstream http://127.0.0.1:17317 `
  --state "$TestRoot\gateway-state.json" `
  --public-url "http://<PC_LAN_IP>:18787" `
  --no-watch
```

> 把 `<PC_LAN_IP>` 换成本机 Wi-Fi 的 IPv4 地址（`ipconfig` 查看）；不要使用 `127.0.0.1` 作为手机地址。若 Windows 防火墙弹窗，只允许「专用网络」。

检查网关：

```powershell
Invoke-RestMethod http://127.0.0.1:18787/v1/health | ConvertTo-Json -Depth 5
# 期望：ok=true，upstream.ok=true
```

配对手机（第三个窗口）：

```powershell
Set-Location 'C:\Users\22472\Desktop\DSH提醒小助手\dsh-mobile-watch\packages\gateway'
node bin/pair.mjs --gateway http://127.0.0.1:18787
```

手机 Safari 打开打印出的配对 URL，输入 8 位码；电脑按 `y` 确认。配对成功后手机回到任务列表，**不要使用主网关的历史 token**。

### 4.7 准备测试会话

在 PC 浏览器打开 `http://127.0.0.1:18080`：

1. 选择 workspace：`C:\Users\22472\AppData\Local\Temp\dsh-m4-edge\workspace`；
2. 新建会话，标题 `M4-EDGE-REJECT`；
3. 在会话权限选择器中选择「只读」/`read-only`（不要选 Auto；若选择器出现 Auto，停止测试，说明 auto-review 仍在测试 profile 中）；
4. 再新建一个会话 `M4-EDGE-CONFLICT`，同样选「只读」。

## 5. 测试用例

### 5.1 M4E-REJECT-01：手机 PWA 拒绝

#### 前置条件

- §4 全部完成，测试插件、测试网关、测试 DSH Web UI 正常；
- 手机已与测试网关配对；
- 会话权限为 `read-only`。

#### 步骤

1. 在 PC 的 `M4-EDGE-REJECT` 会话发送以下固定 prompt（只让 agent 做这一件事）：

   ```text
   这是隔离的 M4 手机拒绝测试，只做以下动作，不要读取其他文件、不要修改仓库：
   1) 必须使用 pwsh 工具执行：
      Set-Content -LiteralPath "C:\Users\22472\AppData\Local\Temp\dsh-m4-edge\workspace\probe-reject.txt" -Value "reject-test" -Encoding utf8
   2) 如果返回 [sandbox: file access denied under read-only mode]，用完全相同的命令重试一次，并带上沙箱升权参数：
      sandbox_permissions: "workspace-write"
      justification: "M4 手机拒绝测试：把测试标记写入隔离的临时 workspace"
   3) 不要自动继续其他步骤；等待审批结果，如果被拒绝就报告“已拒绝，未写入”。
   ```

2. PC UI 出现审批卡；记下任务 ID（PWA 任务详情 URL 中的 `#/task/<task_id>`）。在手机上打开 `M4-EDGE-REJECT` 任务详情，确认显示「需要你的决定」卡片，**先不要点**。

3. 在 PC 查询 pending action：

   ```powershell
   $TestRoot = Join-Path $env:LOCALAPPDATA 'Temp\dsh-m4-edge'
   $taskId = '<task_id>'
   $actions = Invoke-RestMethod "http://127.0.0.1:17317/v1/actions?task_id=$taskId"
   $actions.actions | ConvertTo-Json -Depth 8
   # 期望：status=pending，tool_name=pwsh，reason 包含 M4
   $action = $actions.actions | Where-Object { $_.status -eq 'pending' } | Select-Object -First 1
   ```

4. 在手机上点「拒绝」。

5. 预期手机 UI：先提示已提交；刷新任务详情后显示「审批已处理」/「已在手机提交」。PC 的旧审批卡可能仍显示等待，属 M4-A 已知限制，刷新/切换会话即可消失，不影响审批结果。

6. 在 PC 断言 action 与副作用：

   ```powershell
   Start-Sleep -Milliseconds 500
   $final = Invoke-RestMethod "http://127.0.0.1:17317/v1/actions/$($action.action_id)"
   $final | ConvertTo-Json -Depth 8
   # 期望：status=decided，decision=mobile，outcome=rejected

   Test-Path "$TestRoot\workspace\probe-reject.txt"
   # 期望：False（工具 body 未执行）
   ```

7. 在 PC 的 DSH 会话里确认工具结果：应显示用户拒绝（类似 `the user rejected tool "pwsh"`），不得出现文件写入成功。

8. 保存证据到 `dsh-mobile-watch/docs/evidence/m4-edge/reject-mobile.json`，结构参考：

   ```json
   {
     "test": "M4E-REJECT-01",
     "generated_at": "<ISO8601>",
     "profile": "m4-edge",
     "action": { "action_id": "<id>", "task_id": "<id>", "tool_name": "pwsh", "status": "decided", "decision": "mobile", "outcome": "rejected" },
     "file_absent": true,
     "note": "手机 PWA 拒绝后 DSH 工具未执行"
   }
   ```

#### 通过标准

- [ ] PWA 任务详情出现过「需要你的决定」卡片；
- [ ] 手机提交返回 accepted（PWA 不报错）；
- [ ] action 最终为 `decided / mobile / rejected`；
- [ ] `probe-reject.txt` 不存在；
- [ ] 主 profile 未被修改（§8 统一验证）。

---

### 5.2 M4E-CONFLICT-01：桌面先允许 → 手机 conflict

#### 前置条件

- 同 5.1；使用新的 `M4-EDGE-CONFLICT` 会话，权限 `read-only`；
- 手机已打开该任务详情并保持页面，**不要刷新**（刷新会隐藏旧卡片，无法复现手机侧 conflict）。

#### 步骤

1. 在 PC 的 `M4-EDGE-CONFLICT` 会话发送：

   ```text
   这是隔离的 M4 桌面先允许、手机后提交的冲突测试，只做以下动作，不要读取其他文件、不要修改仓库：
   1) 必须使用 pwsh 工具执行：
      Add-Content -LiteralPath "C:\Users\22472\AppData\Local\Temp\dsh-m4-edge\workspace\probe-conflict.log" -Value "executed-conflict-test" -Encoding utf8
   2) 如果返回 [sandbox: file access denied under read-only mode]，用完全相同的命令重试一次，并带上：
      sandbox_permissions: "workspace-write"
      justification: "M4 桌面先允许测试：向隔离的临时 workspace 追加测试标记"
   3) 等待审批；如果被允许，只执行一次；如果被拒绝，报告“已拒绝”。
   ```

2. PC 出现审批卡；手机打开 `M4-EDGE-CONFLICT` 任务详情，确认审批卡已出现后**停在页面不要动**。

3. 在 PC 端点击「允许一次」。等待 PC 工具卡完成，确认 `probe-conflict.log` 已有且只有一行：

   ```powershell
   $TestRoot = Join-Path $env:LOCALAPPDATA 'Temp\dsh-m4-edge'
   Get-Content "$TestRoot\workspace\probe-conflict.log"
   (Get-Content "$TestRoot\workspace\probe-conflict.log" | Measure-Object -Line).Lines
   # 期望：1 行
   ```

4. 在 PC 查询桌面决定后的 action：

   ```powershell
   $taskId = '<task_id>'
   $actions = Invoke-RestMethod "http://127.0.0.1:17317/v1/actions?task_id=$taskId"
   $action = $actions.actions | Where-Object { $_.status -eq 'resolved' } | Select-Object -First 1
   $action | ConvertTo-Json -Depth 8
   # 期望：status=resolved，decision=desktop，outcome=allowed-once
   ```

5. 在手机上对**仍显示的旧审批卡**点「允许一次」。当前 PWA 版本预期会提示 `审批提交失败：HTTP 409`（见 §7 已知 UI 问题）；即使提示文案不同，也应记录实际文案和截图。

6. 在 PC 用同一个 action 直接断言 conflict（作为旁路证据，不替代手机步骤）：

   ```powershell
   $r = Invoke-WebRequest -SkipHttpErrorCheck -Method Post `
     -Uri "http://127.0.0.1:17317/v1/actions/$($action.action_id)/decision" `
     -ContentType 'application/json' `
     -Body '{"decision":"allowed-once"}'
   $r.StatusCode
   $r.Content
   # 期望：409
   # body: {"status":"conflict","action_id":"...","current_status":"resolved","current_decision":"desktop"}
   ```

7. 再次确认没有第二次执行：

   ```powershell
   (Get-Content "$TestRoot\workspace\probe-conflict.log" | Measure-Object -Line).Lines
   # 期望：仍为 1 行
   ```

8. 保存 `docs/evidence/m4-edge/conflict-desktop-first.json`：

   ```json
   {
     "test": "M4E-CONFLICT-01",
     "generated_at": "<ISO8601>",
     "profile": "m4-edge",
     "action": { "action_id": "<id>", "task_id": "<id>", "status": "resolved", "decision": "desktop", "outcome": "allowed-once" },
     "mobile_submit": { "http_status": 409, "status": "conflict", "current_status": "resolved", "current_decision": "desktop" },
     "tool_executions": 1,
     "note": "桌面先允许，手机旧卡片后提交返回 conflict，工具只执行一次"
   }
   ```

#### 通过标准

- [ ] PC 先点「允许一次」后工具执行，`probe-conflict.log` 恰好 1 行；
- [ ] action 为 `resolved / desktop / allowed-once`；
- [ ] 手机提交后出现 HTTP 409 conflict，body 的 `current_status=resolved`、`current_decision=desktop`；
- [ ] 日志仍为 1 行，没有第二次执行；
- [ ] 主 profile 未被修改（§8 统一验证）。

---

### 5.3 可选负向检查（不纳入本轮门禁）

- **expired**：保持 pending 超过 5 分钟（`ApprovalBridge` TTL），手机再提交应得 `410 expired`；等待时间较长，可选做；
- **插件重启**：pending 时重启测试 DSH 进程，旧 action 应查询为 `expired`，不得补执行；
- **重复提交**：手机已拒绝后再次提交应得 `409 conflict`，且 `current_decision=mobile`。

这三项用于加强 M4 边界证据，不阻塞拒绝/冲突两个主用例。

## 6. 断言字段与证据规范

| 字段/对象 | 拒绝用例期望 | 冲突用例期望 |
| --- | --- | --- |
| `action.status` | `decided` | `resolved` |
| `action.decision` | `mobile` | `desktop` |
| `action.outcome` | `rejected` | `allowed-once` |
| HTTP decision 响应 | `200 {"status":"accepted"}` | 手机旧卡：`409 {"status":"conflict"}`；直接旁路：同 409 |
| `current_status` / `current_decision` | 不适用 | `resolved` / `desktop` |
| 工具副作用 | 无 `probe-reject.txt` | `probe-conflict.log` 恰好 1 行 |

证据文件统一放在 `dsh-mobile-watch/docs/evidence/m4-edge/`，至少包含：

- 手机截图：审批卡、拒绝后状态、冲突提示；
- PC 截图：DSH 工具结果/审批卡；
- 两个 JSON：`reject-mobile.json`、`conflict-desktop-first.json`；
- 主 profile 前后哈希对比（§8）。

## 7. 已知 UI 问题与验收解释

### 7.1 PWA 把 409 当成通用错误（建议另修）

当前 `apps/web/app.js` 的 `api()` 对非 2xx 响应统一 `throw new Error(...)`（约第 164–176 行），而 `bindApprovalActions` 的 catch 显示 `审批提交失败：HTTP 409`（约第 532–539 行）。因此：

- **协议层**：409 + `status=conflict` 是正确行为，M4E-CONFLICT-01 可以通过；
- **体验层**：手机用户看到「审批提交失败」而不是「该审批已在电脑处理」，不够友好。建议另开小修：`api()` 对 409 conflict 返回结构化结果，按钮处理显示「该审批已被处理」，随后 `renderTask` 刷新。

本测试方案**不修改代码**；如果 M4 验收要求手机端冲突文案友好，应把该小修作为 M4-EDGE-UI-01 单独修复后再复测。

### 7.2 桌面审批卡残留（M4-A 已记录）

手机拒绝/允许后，DSH 桌面端旧审批卡可能不会立刻消失，因为 DSH client 没有广播 `approval/decided` 给其他已打开 UI；任务实际状态已经正确。测试记录时应刷新/切换会话后再截图，不把它当作审批失败。

### 7.3 PWA 刷新会隐藏旧审批卡

PWA 只在任务详情渲染时拉取 `/v1/actions`，不会实时刷新。冲突用例必须让手机页面保持旧卡片，先在 PC 允许，再在手机点击；若手机提前刷新，旧卡片消失是正常现象，不是 bug，但该轮需要重做。

## 8. 清理与回滚

> 先保存证据，再清理。所有删除前先 `Resolve-Path` 并核对绝对路径；不要删除 `desktop` profile。

### 8.1 停止测试进程

1. 在启动 DSH Web UI 的窗口按 `Ctrl+C`，等待退出；确认 18080 不再监听；
2. 在启动网关的窗口按 `Ctrl+C`；确认 18787 不再监听；
3. 可选确认：

   ```powershell
   Get-NetTCPConnection -LocalPort 18080,17317,18787 -State Listen -ErrorAction SilentlyContinue |
     Select-Object LocalPort,OwningProcess
   # 期望：无输出
   ```

### 8.2 手机侧清理

- 打开测试网关 origin 的 Safari 设置：清除该站点数据，或在测试网关 state 删除后不再使用；
- 如果曾把测试页面「添加到主屏幕」，删除该「DSH Watch Test」图标（与主 PWA 区分）；
- 不要删除主 PWA 的配对/通知设置。

### 8.3 校验主 profile 未被改动

```powershell
$TestRoot = Join-Path $env:LOCALAPPDATA 'Temp\dsh-m4-edge'
$MainProfile = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'

$before = Get-Content "$TestRoot\main-profile-before.json" | ConvertFrom-Json
$after = Get-FileHash "$MainProfile\package.json", "$MainProfile\cordis.patch.yml", "$MainProfile\pnpm-lock.yaml" -Algorithm SHA256
$after | Format-Table Path, Hash -AutoSize

# 逐项比较；任何差异都停止清理并人工检查
Compare-Object ($before.Hash) ($after.Hash)
# 期望：无输出
```

再确认主服务仍然正常：

```powershell
Invoke-RestMethod http://127.0.0.1:7317/v1/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8787/v1/health | ConvertTo-Json -Depth 4
# 期望：ok=true / upstream.ok=true
```

### 8.4 删除测试 profile 和临时目录

```powershell
$profilePath = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh\profiles\m4-edge'))
$expectedProfile = 'C:\Users\22472\.dsh\profiles\m4-edge'
if ($profilePath -ne $expectedProfile) { throw "拒绝删除：$profilePath" }
if (Test-Path -LiteralPath $profilePath) {
  Remove-Item -LiteralPath $profilePath -Recurse -Force
}

$TestRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Temp\dsh-m4-edge'))
$expectedRoot = 'C:\Users\22472\AppData\Local\Temp\dsh-m4-edge'
if ($TestRoot -ne $expectedRoot) { throw "拒绝删除：$TestRoot" }
if (Test-Path -LiteralPath $TestRoot) {
  Remove-Item -LiteralPath $TestRoot -Recurse -Force
}
```

删除后检查：

```powershell
Test-Path 'C:\Users\22472\.dsh\profiles\m4-edge'          # False
Test-Path 'C:\Users\22472\AppData\Local\Temp\dsh-m4-edge' # False
```

### 8.5 会话存储检查

本方案通过 `session-persistence-jsonl.root` 把测试会话写到临时目录。若发现 `C:\Users\22472\.dsh\sessions` 出现 `M4-EDGE-*` 测试会话，说明隔离配置未生效：**不要直接删除主会话目录**，先记录并检查 `m4-edge` 的 dump 配置，再单独处理。

## 9. 参考

- `dsh-mobile-watch/docs/M4-A-REPORT.md` §2/§5 待验证/§6（审批桥、待验证项、桌面卡限制）
- `dsh-mobile-watch/packages/dsh-watch/lib/core/approvals.mjs`（5 分钟 TTL、`decided/resolved`、`conflict`、`expired`）
- `dsh-mobile-watch/apps/web/app.js` 第 164–176、508–544 行（PWA 审批卡与 409 现状）
- `dsh-mobile-watch/packages/gateway/README.md`（`--upstream`、`--state`、`--host`、`--public-url`、配对）
- DSH 安装文档：`docs/subsystems/approval.zh.md`、`docs/subsystems/sandbox.zh.md`、`docs/upgrade-guide/v0.2.1-rc.2/auto-review-shutdown/guide.zh.md`
- DSH 版本：`0.2.2-rc.3`；`dsh-watch` 版本：`0.1.0`

## 10. 附：最小触发原理（为什么用 read-only）

1. 测试会话选择 `read-only` 预设（`sandbox=read-only`，`approval=ask`）；
2. `pwsh` 对 workspace 的写操作被沙箱拒绝，返回 `[sandbox: file access denied under read-only mode]`；
3. 同一命令带 `sandbox_permissions: "workspace-write"` + `justification` 重试；
4. `dsh-tool-pwsh` 在真正执行前调用 `ctx.approval`，产生 `approval/request`；
5. `dsh-watch` 的 `ApprovalBridge` 以 `{ global: true, prepend: true }` 先进入 waterfall，但始终 `next()`，保留桌面审批 UI；
6. 手机或桌面先给出有效决定者生效；后到手机返回 `conflict`，不会重复执行工具。

这条路径不依赖 auto-review，也不依赖 `danger-full-access`，是当前 DSH 版本可重复的最小审批触发方式。
