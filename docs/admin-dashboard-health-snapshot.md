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

## 2026-06-12 扩展：关键巡检项预览

首页系统状态进一步展示最近快照中的关键巡检项预览：

- `GET /api/admin/dashboard` 在 `latestSystemHealth.criticalChecks` 中返回最多 8 个关键检查项。
- 关键项优先覆盖 Sub2/OpenAI 上游、本地反代 smoke、资源凭据、共享资源、OpenAI 反代契约、反代运行态、售出交付、API Key、用量同步、pending usage、账务对账、管理员 API 覆盖、Admin 前端入口覆盖和部署运行态。
- 非 `ok` 检查项会优先排序；系统正常时仍保留关键 `ok` 项，作为首页入口的覆盖证据。
- 每个预览项包含 `id`、`label`、`status`、`summary`、`issueCount` 和 `sampleCount`。
- Admin 首页在 `系统状态` 面板展示这些预览项，并提供直接进入 `可用性巡检` 的按钮。

## 2026-06-12 扩展：关键巡检项直达入口

首页关键巡检项进一步补充行内操作按钮：

- Sub2/OpenAI 上游、本地反代 smoke、OpenAI 反代契约和运行态：打开 `反代状态`。
- 共享资源与资源凭据：打开 `共享资源`。
- 反代请求：打开 `反代请求`。
- 支付充值与售出交付：打开 `售出情况`。
- API Key：打开 `API Key`。
- 用量同步和 pending usage：打开 `用量记录`。
- 账务对账、商品目录、订单、租赁、余额、结算和平台入口覆盖问题会分别打开对应管理页面或巡检详情。

## 管理价值

- 管理员进入后台首页即可看到真实巡检状态，而不是静态提示。
- 支付充值、售出交付、Sub2/OpenAI 上游和反代契约等巡检风险可以通过首页被更早发现。
- 首页只读取最近快照，不触发新的巡检，也不会增加巡检历史噪音。
- 管理员不必先打开完整巡检页，也能在首页看到当前阻断集中在哪些关键链路。
- 管理员可以从首页问题预览直接进入对应管理入口，减少从总览页到维修页的跳转成本。

## 验收方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api run build`
- `npm.cmd --prefix user/apps/admin run build`
