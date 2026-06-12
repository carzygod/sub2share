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
- 每个预览项会带出首个问题或候选样本的轻量摘要，包含 `repairAction`、`sub2AccountId`、`resourceType`、`resourceScope`、`supplierEmail`、`requestId` 或 `proxyRequestLogId` 等字段，首页可直接显示推荐维修动作和定位对象。
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

## 2026-06-12 扩展：核心指标直达入口

首页顶部经营指标和经营摘要进一步升级为管理入口：

- `用户数`：打开 `用户管理`。
- `有效租赁`：打开 `租赁通道`，并筛选 `active`。
- `在线资源`：打开 `共享资源`，并筛选 `online`。
- `售出金额` 和 `按量 GMV`：打开 `售出情况`。
- `可用余额`：打开 `余额管理`。
- `累计充值`：打开 `余额流水`，并筛选 `recharge`。
- `累计消费`：打开 `余额流水`，并筛选 `consume`。
- `供给收益`：打开 `结算`。
- `待提现`：打开 `提现`，并筛选 `pending`。
- `订单数`、`用量记录` 分别打开 `订单管理` 和 `用量记录`。

## 2026-06-12 扩展：指标口径筛选直达

首页核心指标入口进一步对齐 dashboard 统计口径：

- `有效租赁` 不再打开全部租赁，而是直接打开 `status=active` 的租赁列表。
- `在线资源` 不再打开全部资源，而是直接打开 `status=online` 的共享资源列表。
- `累计充值` / `累计消费` 会分别打开 `recharge` / `consume` 余额流水。
- `待提现` 会直接打开 `status=pending` 的提现列表。

## 2026-06-12 扩展：关键巡检项上下文跳转

首页关键巡检项的行内按钮进一步使用 `primaryIssue` / `primarySample` 中的定位字段选择更精确的入口：

- 当问题携带 `repairAction=apply_openai_refresh_token_to_sub2_account` 或 `sub2AccountId`，并且来自 `sub2`、`localProxySmoke`、`resourceCredentials` 或 `resources` 时，按钮直接打开 `反代状态`，并预选目标 Sub2/OpenAI 账号。
- 当 `proxy` 或 `localProxySmoke` 问题携带 `requestId`、`proxyRequestLogId` 或 `upstreamRequestId` 且没有更高优先级的 Sub2 修复上下文时，按钮打开对应 `反代请求` 列表。
- 当资源或资源凭据问题携带 `supplierEmail`、`resourceType`、`resourceStatus`、`resourceScope` 或 `sub2AccountId` 时，按钮打开 `共享资源`，并带入筛选与创建默认值。
- 首页上下文摘要新增展示 `resourceStatus`，便于管理员在首页确认资源状态与跳转筛选口径。

## 2026-06-12 扩展：支付巡检充值流水直达

首页关键巡检项继续细化 `payments` 的跳转口径：

- `GET /api/admin/dashboard` 的关键巡检详情预览保留 `walletTransactionList`、`walletTransactionType`、`walletTransactionId`、`walletLookup`、`walletList` 和 `salesList`。
- `payments` 被纳入关键巡检优先级，生产环境 mock 充值或充值关闭 warning/error 会稳定进入首页列表。
- 当 `payments` 问题携带 `walletTransactionId` 时，行内按钮直接打开对应余额流水搜索结果。
- 当问题携带 `walletTransactionList=true` 或 `walletTransactionType=recharge` 时，行内按钮打开 `余额流水` 并筛选充值流水。
- 当只携带钱包定位字段时，行内按钮打开 `余额管理`；当只携带 `salesList=true` 时，仍打开 `售出情况` 作为收入复核后备入口。
- 首页摘要会展示 `walletTransactionType`、`walletTransactionId`、`walletLookup` 和 `walletId`，便于管理员确认本次跳转是充值流水复核而不是售出交付复核。

## 2026-06-12 扩展：Smoke 失败诊断穿透

首页关键巡检项继续补齐 Sub2/OpenAI smoke 失败的诊断字段：

- `GET /api/admin/dashboard` 的关键巡检详情预览保留 `actionHint`、`proxyRequestPath`、`proxyRequestStatusCode`、`proxyRequestErrorCode`、`model`、`modelsOk`、`responsesOk`、`localProxyOk`、`smokeTestSkippedReason` 和 `ageMinutes`。
- 首页摘要可以直接展示 `/v1/responses`、HTTP 状态码、代理错误码、自检模型和 smoke 分段结果。
- 从首页点击 `sub2`、`localProxySmoke`、`resourceCredentials` 或 `resources` 进入 `反代状态` 时，这些字段会进入 `修复定位` 诊断块。
- `修复定位` 会同时显示维修建议、目标账号、资源上下文、请求定位、Smoke 分段结果和失败请求，减少管理员在首页、完整巡检页和反代状态页之间来回复核。

## 管理价值

- 管理员进入后台首页即可看到真实巡检状态，而不是静态提示。
- 支付充值、售出交付、Sub2/OpenAI 上游和反代契约等巡检风险可以通过首页被更早发现。
- 首页只读取最近快照，不触发新的巡检，也不会增加巡检历史噪音。
- 管理员不必先打开完整巡检页，也能在首页看到当前阻断集中在哪些关键链路。
- 管理员可以从首页问题预览直接进入对应管理入口，减少从总览页到维修页的跳转成本。
- 管理员可以从经营指标直接进入用户、共享、余额、售出和供给收益管理页面。
- 管理员从指标进入列表时默认看到与指标口径一致的数据集，减少二次筛选。
- 管理员从首页支付巡检 warning 可以优先进入充值流水，快速确认余额入账影响，再按需进入售出情况复核收入口径。
- 管理员从首页进入反代修复页后，可以直接确认失败路径、HTTP 状态码和 smoke 分段结果，不必再回到完整巡检页二次定位。

## 验收方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api run build`
- `npm.cmd --prefix user/apps/admin run build`
