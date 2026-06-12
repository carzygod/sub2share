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

- `GET /api/admin/dashboard` 的关键巡检详情预览保留 `actionHint`、`proxyRequestPath`、`proxyRequestStatusCode`、`proxyRequestErrorCode`、`model`、`modelsOk`、`responsesOk`、`localProxyOk`、`smokeTestSkippedReason`、`ageMinutes`、`stale`、`staleThresholdMinutes` 和 `freshMinutesRemaining`。
- 首页摘要可以直接展示 `/v1/responses`、HTTP 状态码、代理错误码、自检模型和 smoke 分段结果。
- 从首页点击 `sub2`、`localProxySmoke`、`resourceCredentials` 或 `resources` 进入 `反代状态` 时，这些字段会进入 `修复定位` 诊断块。
- `修复定位` 会同时显示维修建议、目标账号、账号诊断、资源上下文、请求定位、Smoke 分段结果和失败请求，减少管理员在首页、完整巡检页和反代状态页之间来回复核。

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
- 管理员从首页进入反代修复页后，可以同时看到 smoke 证据年龄和过期阈值；如果失败 smoke 证据已过期，会直接看到“证据已过期”，便于修复后立即重新运行端到端自检刷新当前 `/v1/responses` 证据。
- 当 smoke 证据尚未过期时，首页进入反代修复页也会显示剩余多少分钟过期，帮助管理员判断是否需要优先刷新证据。

## 验收方式

- `npm.cmd --prefix user/apps/api run typecheck`
- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/api run build`
- `npm.cmd --prefix user/apps/admin run build`

## 2026-06-12 扩展：共享资源巡检入口优先

首页关键巡检项继续细化 `resources` 的跳转口径：

- `resources` 巡检项表示共享资源池本身缺失或不可用时，即使 issue 同时携带 `repairAction` 或 `sub2AccountId`，首页按钮也优先显示 `打开共享资源`。
- 点击 `resources` 关键巡检项会进入 `共享资源` 列表，并带入 `supplierEmail`、`resourceType`、`resourceStatus`、`resourceScope` 和 `sub2AccountId` 作为筛选与创建默认值。
- `sub2`、`resourceCredentials` 和 `localProxySmoke` 仍保持反代维修优先，继续打开 `反代状态` 并预填目标 Sub2/OpenAI 账号。
- 独立说明见 `docs/admin-dashboard-resource-health-routing.md`。

## 2026-06-12 扩展：商品目录巡检直达商品

首页关键巡检项继续细化 `productCatalog` 的跳转口径：

- `GET /api/admin/dashboard` 的 `latestSystemHealth.criticalChecks[].primaryIssue` 会保留 `productId`、`productName` 和 `priceId`。
- `productCatalog` warning 纳入首页关键巡检优先级，避免被普通 warning 挤出最多 8 条的首页列表。
- 当 `productCatalog` 问题携带商品定位字段时，首页按钮显示为“打开商品”，并按 `productId`、`priceId`、`productName` 的优先级打开商品管理列表。
- 首页上下文摘要会展示商品 ID、商品名和价格 ID，管理员可以在总览页确认是哪一个可售商品受 ready Codex 交付资源缺失影响。
- 若商品目录问题没有具体定位字段，按钮仍回退到商品配置页。

该能力让“商品可售但交付资源未 ready”的风险可以从首页直接落到商品管理入口，不再需要管理员先进入完整可用性巡检页再复制商品 ID。

## 2026-06-12 扩展：商品目录巡检共享资源修复入口

`productCatalog` 的首页关键巡检项继续补齐共享资源修复路径：

- 带 `repairAction=apply_openai_refresh_token_to_sub2_account` 的商品目录问题会继承当前 Sub2 修复候选账号字段，包括 `sub2AccountId`、`sub2AccountName`、`accountStatus`、`credentialsStatus` 和 `schedulable`。
- `GET /api/admin/dashboard` 的关键巡检预览保留 `resourceList`，首页摘要可以显示这条商品风险同时关联共享资源修复。
- Admin 首页在 `productCatalog` 问题具备资源修复上下文时，除“打开商品”外，还会显示“打开共享资源”按钮。
- 点击“打开共享资源”会带入 `supplierEmail`、`resourceType`、`resourceScope`、`resourceStatus`、`sub2AccountId`、账号诊断、失败 smoke 证据和 `repairAction`，共享资源创建表单会默认继续凭据应用和端到端 smoke 验收。

这样管理员既能从首页确认受影响商品，也能直接进入真正恢复交付能力所需的生产 Codex 共享资源修复入口。

## 2026-06-12 扩展：共享资源修复表单保留商品上下文

从 `productCatalog` 风险进入共享资源修复时，资源创建默认值继续保留商品定位：

- Dashboard 与完整可用性巡检页的“打开共享资源”都会传递 `productId`、`productName` 和 `priceId`。
- 共享资源创建表单的修复诊断条新增 `Product` 项，显示触发风险的商品名、商品 ID 和价格 ID。
- 该上下文只作为管理员确认信息，不影响资源筛选、凭据保存或 Sub2 smoke 行为。

管理员在创建或修复生产 Codex 共享资源前，可以直接确认这次修复是为了恢复哪一个可售商品的交付能力。

## 2026-06-13 扩展：共享资源修复表单保留账号诊断

从 `resources`、`productCatalog` 或完整巡检页进入共享资源修复时，资源创建默认值继续保留账号诊断：

- Dashboard 与完整可用性巡检页的“打开共享资源”都会传递 `sub2AccountName`、`accountStatus`、`credentialsStatus`、`schedulable`、`tempUnschedulableReason`、`accountMessage` 和 `updatedAt`。
- 共享资源创建表单的修复诊断条新增 `Account status` 与 `Account diagnostics`。
- 失败请求诊断继续保留 `ageMinutes`、`staleThresholdMinutes` 和 `freshMinutesRemaining`。

管理员在创建生产 Codex 共享资源前，可以在同一表单确认目标 Sub2 账号是否因 token invalidated 等原因不可调度。

## 2026-06-12 扩展：首页巡检快照新鲜度

首页系统状态继续补齐“快照是否仍代表当前状态”的判断：

- `GET /api/admin/dashboard` 的 `latestSystemHealth` 新增：
  - `ageMinutes`
  - `stale`
  - `staleThresholdMinutes`
- dashboard 新鲜度阈值为 60 分钟；最近快照达到或超过该阈值时，`stale=true`。
- Admin 首页在系统状态标题处显示“快照过期”，并在表格中展示“X 分钟前/小时之前”和当前阈值。
- 该能力不会自动触发新的 `GET /api/admin/system-health`，因此不会增加巡检写入噪音；管理员仍可点击“打开巡检”手动刷新当前快照。

这样管理员不会把很久以前的 Sub2/OpenAI、共享资源、余额或售出交付巡检结果误判为当前状态。

## 2026-06-13 扩展：完整巡检详情商品名可读

完整 `可用性巡检` 页的 issue ref 与 sample summary 继续补齐商品定位字段：

- `productName` 纳入 `adminSystemHealthIssueRefFields`。
- `productName` 纳入 `adminSystemHealthSampleSummaryFields`。
- 当线上 `productCatalog`、`resources`、`resourceCredentials`、`sub2` 或 `localProxySmoke` 问题携带商品上下文时，管理员在详情行中可以直接看到商品名、商品 ID 和价格 ID。

该能力不改变首页关键巡检排序、跳转目标、资源 ready 判定或 Sub2/OpenAI 调用，只让巡检详情中的商品定位更适合人工排障。

## 2026-06-13 扩展：完整巡检商品跳转支持商品名兜底

完整 `可用性巡检` 页和首页关键巡检项现在统一使用共享的 `adminProductLookupCandidate()` 选择商品跳转关键词：

- 优先使用 `productId`。
- 其次使用 `priceId`。
- 如果线上巡检证据只保留了 `productName`，仍然可以通过商品名打开商品管理列表。

这样在 `productCatalog`、`resources`、`resourceCredentials`、`sub2` 或 `localProxySmoke` 问题只携带商品名时，管理员不需要复制可读名称再手动搜索，行内“打开商品”仍然能落到对应商品筛选入口。

## 2026-06-13 扩展：首页 Sub2 诊断保留账号消息

首页关键巡检预览继续补齐 Sub2 修复上下文：

- `GET /api/admin/dashboard` 的关键巡检预览保留 `accountMessage`。
- `sub2` 主问题可以在保留通用阻断 `message` 的同时，把首个可修复账号的失败摘要写入 `accountMessage`。
- Admin 首页打开 `反代状态` 时优先使用 `accountMessage` 作为账号诊断；旧快照没有该字段时仍回退到 `message`。

这样管理员从首页 `sub2` 检查进入维修页时，可以直接看到 `token_invalidated` 等账号级失败原因，不必先打开完整巡检候选样本。

## 2026-06-13 扩展：smoke 证据绝对过期时间

- `GET /api/admin/dashboard` 的关键巡检详情预览继续保留 smoke 新鲜度上下文，并新增 `staleAt`。
- `localProxySmoke`、`sub2`、`resourceCredentials`、`resources` 或 `productCatalog` 相关修复入口携带 `staleAt` 时，Admin 会把该字段传入 `反代状态` 或 `共享资源` 修复上下文。
- `反代状态 -> 修复定位 -> 失败请求` 与共享资源创建表单 `Failure` 项会显示 `staleAt <ISO 时间>`，用于确认当前 smoke 证据的绝对过期时刻。
- 该能力只补齐诊断上下文，不触发新的系统巡检、Sub2API 调用或真实 OpenAI/Codex smoke 请求。

## 2026-06-13 扩展：跨巡检项 smoke 证据继承

- 系统健康在生成 dashboard 快照前，会把最新 `localProxySmoke` 可修复失败证据补入相关 Sub2 修复问题。
- 首页关键巡检中的 `productCatalog`、`resources`、`resourceCredentials` 和 `sub2` 主问题在缺少字段时会保留 `/v1/responses` 失败路径、状态码、代理错误码、请求 ID、证据年龄、剩余新鲜时间和 `staleAt`。
- 首页从任一相关风险进入 `反代状态` 或 `共享资源` 时，都能携带同一份 smoke 失败上下文。
- 该继承只补齐缺失字段，不覆盖原巡检项的消息、修复建议或商品/账号定位。

## 2026-06-13 扩展：首页关键巡检保留 smoke 审计定位

- 共享 smoke 失败证据继承会继续补入 `auditLogId`，dashboard 关键巡检预览已有该字段白名单。
- 首页 `productCatalog`、`resources`、`resourceCredentials` 和 `sub2` 主问题在携带 smoke 失败上下文时，也能保留产生证据的审计记录 ID。
- 管理员从首页进入完整巡检后，可以沿同一条证据继续打开审计记录，确认 smoke 的脱敏执行结果。
- 该能力只补齐审计定位字段，不改变首页关键巡检排序或健康状态判定。

## 2026-06-13 扩展：首页 Sub2 候选样本保留修复上下文

- `GET /api/admin/dashboard` 的 `sub2.primarySample` 来自账号候选样本时，也会继承 `repairAction`、`sub2Status`、`resourceType` 和 smoke/audit 证据。
- 首页 Sub2 关键巡检既可以从主问题保留失败证据，也可以从候选样本保留同一证据。
- 这样管理员打开完整巡检或反代状态时，不会因为点击样本行而丢失 `/v1/responses` 失败路径和审计记录。
- 该能力只补齐 dashboard 预览数据，不改变关键巡检排序、状态聚合或 Sub2API 调用。

## 2026-06-13 扩展：首页保留 smoke 清理证据

- `GET /api/admin/dashboard` 的关键巡检预览继续保留完整 smoke 审计与清理字段：
  - `sub2Status`
  - `auditAction`
  - `keyDisabled`
  - `proxyRequestLogCount`
- `primaryIssue` 和 `primarySample` 都会保留这些字段。
- 首页关键巡检与完整 `可用性巡检` 对同一条 smoke 失败证据的摘要保持一致，管理员无需进入详情页才能确认临时 Key 清理和代理日志数量。
- 该能力只扩展 dashboard 预览字段，不改变健康状态聚合或排序。

## 2026-06-13 扩展：首页保留关键巡检 metrics

- `GET /api/admin/dashboard` 的 `latestSystemHealth.criticalChecks[]` 新增 `metrics` 预览。
- 预览只保留标量字段，忽略嵌套对象，避免把完整详情塞进首页。
- `openAiProxyContract` 等没有 issue/sample 的 ok 关键巡检也可以在首页展示核心证据：
  - `corePathSamples`
  - `routesCorePathSamples`
  - `preservesRawPathAndQuery`
  - `normalizesSub2BaseTrailingSlash`
  - `forwardsUpstreamHeaders`
  - `routesResponsesItems`
- Admin 首页在关键巡检没有 issue/sample 上下文时，会回退展示 metrics 摘要。

这样管理员在首屏就能确认 OpenAI/Codex 反代契约是否覆盖核心 `/v1` 路径并保留 Sub2API 原始 path/query，而不必先进入完整巡检详情。

## 2026-06-13 扩展：首页保留反代请求头透传证据

- `GET /api/admin/dashboard` 的 `openAiProxyContract.metrics` 预览新增 `forwardsUpstreamHeaders`。
- 该字段来自 `inspectOpenAiProxyContract()` 的上游请求头样例检查，证明：
  - 本地 `authorization` 不会透传到 Sub2API。
  - 售出的 Sub2API Key 会重注入到上游 `authorization`。
  - `host`、`content-length`、`connection` 等 hop-by-hop headers 会被剥离。
  - `content-type`、`openai-beta`、trace header、`x-forwarded-*` 和 `x-request-id` 等诊断上下文会保留/补齐。
- Admin 首页在 `openAiProxyContract` 没有 issue/sample 时，metrics 回退摘要会展示该字段。

这样管理员在首页即可同时看到路径覆盖、query 透传和请求头透传三类反代契约证据。

## 2026-06-13 扩展：首页稳定展示管理员入口覆盖

- `GET /api/admin/dashboard` 的 `latestSystemHealth` 新增 `adminEntryCoverage`。
- 该字段独立于 `criticalChecks` top 8 切片，即使当前 Sub2/OpenAI、资源、商品和支付等问题占满首屏关键巡检，也会稳定返回：
  - `adminCapabilities` API 能力矩阵覆盖摘要。
  - `adminSurfaceCoverage` Admin 前端入口覆盖摘要。
- Admin 首页系统状态表新增“管理员入口”行，展示 API 与前端核心范围覆盖、路由覆盖和入口覆盖。
- API 单元测试覆盖：当 `adminCapabilities` 与 `adminSurfaceCoverage` 被 top 8 挤出时，`adminEntryCoverage` 仍返回 `ok` 与完整摘要。

这样“用户、共享、余额、售出、OpenAI/Codex 反代”的完整管理员入口能力不会因为其他可用性风险较多而从首页消失。

## 2026-06-13 扩展：首页稳定展示上游阻断摘要

- `GET /api/admin/dashboard` 的 `latestSystemHealth` 新增 `upstreamBlocker`。
- 该字段独立于 `criticalChecks` top 8 切片，从 `sub2`、`localProxySmoke`、`resourceCredentials`、`resources` 和 `productCatalog` 中提炼当前最需要管理员处理的 Sub2/OpenAI 上游问题。
- 同级错误中会优先选择携带 `actionHint`、`repairAction`、`sub2AccountId`、`resourceId` 或 `resourceList` 的可操作记录，避免首页只展示不可执行的阻断码。
- `upstreamBlocker.check` 保留原始 dashboard 健康检查预览，Admin 首页可以复用现有跳转逻辑打开 `反代状态`、`共享资源` 或完整巡检。
- Admin 首页系统状态表新增“上游阻断”行，并在关键巡检列表前展示一条可点击的阻断摘要。

这样管理员进入后台首屏时，可以同时确认“真实不可用点在 Sub2/OpenAI 上游凭据”和“下一步应去哪里处理”，不需要先展开完整巡检才能定位维修入口。

## 2026-06-13 扩展：首页上游阻断保留 smoke 证据新鲜度

- `GET /api/admin/dashboard` 的 `latestSystemHealth.upstreamBlocker` 继续补齐最近 smoke 证据字段：
  - `evidencePath`
  - `evidenceStatusCode`
  - `evidenceErrorCode`
  - `evidenceModel`
  - `evidenceResponsesOk`
  - `evidenceLocalProxyOk`
  - `evidenceAgeMinutes`
  - `evidenceStale`
  - `evidenceStaleThresholdMinutes`
  - `evidenceFreshMinutesRemaining`
  - `evidenceStaleAt`
- Admin 首页“上游阻断”行会把 smoke 路径、模型、证据是否过期、证据年龄、HTTP 状态和代理错误码拼入摘要。
- 阻断卡片也会在修复建议下方展示同一段 smoke 证据新鲜度。
- 该能力只提炼已有 `primaryIssue` 或 `primarySample` 字段，不触发新的 Sub2API 调用或真实 OpenAI/Codex 请求。

这样当 `/v1/responses` smoke 证据已经过期时，管理员不必展开第二条 `localProxySmoke` 检查，也能在首屏上游阻断摘要里看到“需要重新跑端到端自检”。
