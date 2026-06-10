# 管理员首页巡检快照

实现日期：2026-06-10

## 背景

管理后台首页此前在 `系统状态` 区块展示静态健康文案，无法反映 `GET /api/admin/system-health` 已经识别出的 Sub2/OpenAI 上游、支付充值、售出交付、API Key 准入或账务对账风险。管理员进入首页时可能看到与真实巡检不一致的状态。

## 已实现范围

- `GET /api/admin/dashboard` 返回最近一条 `SystemHealthSnapshot`。
- 首页 `系统状态` 区块改为展示最近巡检快照：
  - 整体状态：`ok`、`warning`、`error`。
  - 最近巡检时间。
  - 快照来源。
  - ok / warning / error 摘要数量。
- 如果系统尚无巡检快照，首页显示 `尚无巡检快照`，不再伪造正常状态。
- 前端新增 `health-row error` 样式，错误状态在首页以红色呈现。

## 管理价值

- 管理员进入后台首页即可看到真实巡检状态，而不是静态提示。
- 支付充值、售出交付、Sub2/OpenAI 上游和反代契约等巡检风险可以通过首页被更早发现。
- 首页只读取最近快照，不触发新的巡检，也不会增加巡检历史噪音。

## 验收方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api run build`
- `npm.cmd --prefix user/apps/admin run build`

