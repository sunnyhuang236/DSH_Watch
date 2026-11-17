# M4-C 轨迹/费用/子代理

日期：2026-11-15｜状态：**PWA 真机验收通过**（轨迹折叠/费用暂无数据/子代理信息）。

## 已实现

- 轨迹按 `run_id`/`payload.turn` 分组；
- 最近一轮和包含异常的一轮默认展开，其余轮次折叠；
- 事件显示轮次、事件类型、工具名、时间和 seq；
- 费用字段固定 `null` 时显示 **暂无数据**，不显示 0；
- 子代理显示数量、委派深度、agent 状态；
- PWA 缓存升级 `dsh-watch-v7`（2026-11-17 修复 sw.js 乱码后提升到 `dsh-watch-v8`）。

## 数据边界

- DSH 当前只有 token，无金额/币种：`cost` 永远 `null`，因此费用显示“暂无数据”；
- 子代理信息来自 `agent_count`/`delegation_depth`/`agent_state`；父子会话详情仍可在任务列表中查看；
- 无确定进度时显示当前步骤/事件，不显示虚假百分比。

## 验证

- `node --check apps/web/app.js` 通过；
- `npm test` 74/74 通过；
- 真机截图：`docs/evidence/m4/m4c-detail.jpg`（子代理 2 个、费用暂无数据、轨迹按轮次折叠）。
