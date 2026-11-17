# M4-B 问答（后端 + PWA 卡片）

日期：2026-11-15｜状态：**代码完成、测试 74/74、手机 PWA 回答真机通过**（`q_e400daad…` / `decision=mobile` / `answered`）。

## 已实现

- `lib/core/questions.mjs`：监听 `user-questions/request`，保留桌面 UI，手机/桌面先答者生效；
- 答案校验：每问题 id 恰好一次、选项必须属于原 options、单选/多选规则；
- 插件 API：
  - `GET /v1/questions?task_id=...`
  - `GET /v1/questions/<id>`
  - `POST /v1/questions/<id>/answer`（body `{answers:[{id,selected,custom?}]}`）
- 网关反向代理 `/v1/questions*`（设备 token）；
- PWA 任务详情新增“需要你回答”卡片：单选/多选/补充文本/提交；
- 缓存升级 `dsh-watch-v6`（新增问答代码必须刷新 PWA）。

## 已验证

- 单元/API 测试：**74/74 通过**；
- 真实请求 `q_e8410bc6-1fb4-4d9e-9c1d-9b7afce78fe7`：
  - 问题正文：`M4-B 联调测试：请选择「继续」或「暂停」`
  - `decision=desktop`（桌面先答）
  - `resolved`，说明桥接和桌面保留正常；
- **手机真机回答** `q_e400daad-b220-4d6c-8544-1df171f16448`：
  - PWA v6 任务详情出现“需要你回答”卡片；
  - 手机选择「手机回答」；
  - `status=answered`、`decision=mobile`；
  - DSH `ask_user_question` 收到答案，工具继续；
  - 证据：`docs/evidence/m4/question-mobile.json`。

## 待验证

1. 强制关闭/重新打开 PWA（加载 v6）后，在 PWA 任务详情回答一条新问题；
2. 确认 action `decision=mobile`、DSH 工具收到答案并继续；
3. 手机/桌面同时答题的 conflict 边界。

## 安全边界

- 问题只存插件内存；不写快照、不落盘正文；
- 手机接口需设备 token；
- 不提供超时重放；插件重启后旧问题 `expired`。
