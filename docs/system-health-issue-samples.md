# 系统巡检问题与候选样本展示

实现日期：2026-06-10

## 背景

`GET /api/admin/system-health` 已经为部分检查项返回 `detail.issues`，例如 OpenAI/Codex API Key 准入、OpenAI 反代契约和售出交付阻断。资源凭据可应用性巡检还会返回 `detail.samples`，用于展示可操作候选对象。此前管理后台只展示检查项状态、结论和指标，管理员需要直接调用 API 才能看到具体问题或候选样本。

## 已实现范围

- 管理后台 `可用性巡检` 页面新增 `巡检问题样本` 表。
- 页面会从每个检查项的 `detail.issues` 中抽取最多 100 条样本。
- `反代请求` 巡检项会在最近 1 小时存在异常请求时返回最近 20 条异常样本。
- 管理后台 `可用性巡检` 页面新增 `巡检候选样本` 表。
- 页面会从每个检查项的 `detail.samples` 中抽取最多 100 条样本；当前主要用于展示资源凭据可应用候选。
- 问题样本展示字段：
  - 级别：`error`、`warning` 或检查项状态。
  - 检查项：检查项名称和 ID。
  - 类型：后端返回的 `type`。
  - 对象：自动拼接 `requestId`、`upstreamRequestId`、`proxyRequestLogId`、`auditLogId`、`auditAction`、`areaId`、`view`、`resourceId`、`resourceType`、`resourceStatus`、`resourceScope`、`productId`、`priceId`、`orderId`、`rentalId`、`apiKeyId`、`apiKeyPrefix`、`model`、`smokeTestSkippedReason`、`usageId`、`userId`、`walletId`、`walletAccountId`、`walletTransactionType`、`bindingId`、`sub2AccountId`、`sub2AccountName`、`accountStatus`、`credentialsStatus`、`schedulable`、`sub2BlockingReason`、`sub2GroupId`、`sub2GroupName`、`sub2GroupStatus`、`openAiAccountCount`、`activeOpenAiAccountCount`、`gatewayReachable`、`settlementId`、`settlementRecordId`、`withdrawalId`、`refId`、`expected`、`actual` 等定位字段。
  - 说明：后端返回的 `message`，没有 message 时回退为紧凑 JSON；如果后端返回 `actionHint`，页面会追加展示维修建议。
  - 操作：如果样本包含可定位字段，可直接打开相应管理入口；当前支持共享资源列表、资源详情、用户、订单、租赁、余额账户、API Key、用量、商品、结算、提现和反代请求日志。
- 候选样本展示字段：
  - 检查项：检查项名称和 ID。
  - 对象：复用问题样本的定位字段拼接规则。
  - 摘要：自动拼接 `userEmail`、`amount`、`balanceAfter`、`currency`、`refType`、`refId`、`createdAt`、`supplierEmail`、`resourceType`、`resourceStatus`、`sub2AccountId`、`sub2AccountName`、`accountStatus`、`credentialsStatus`、`schedulable`、`tempUnschedulableReason`、`level`、`maxConcurrency`、`credentialType`、`status`、`keyFingerprint`、`lastRotatedAt`、`updatedAt` 等摘要字段。
  - 操作：如果样本包含 `resourceId`，可直接打开共享资源详情；如果样本来自 Sub2/OpenAI 上游账号，可直接打开反代状态页；如果样本来自充值流水，可直接打开用户、余额、余额流水和售出情况。

## 管理价值

- 售出交付巡检发现缺租赁、缺 endpoint、缺 Sub2 Key、缺 active 本地 API Key 时，管理员可以直接看到受影响订单和租赁。
- API Key 可用性巡检发现钱包、租赁、Key hash、到期等准入问题时，管理员可以直接定位 Key、租赁和用户。
- OpenAI 反代契约巡检发现 endpoint、CORS 或错误类型问题时，管理员可以在同一页看到具体契约问题。
- 用量同步调度巡检发现生产环境禁用自动同步、间隔过长或启动后不立即同步时，管理员可以直接看到配置风险。
- Pending 用量账务巡检发现待恢复扣费 usage 时，管理员可以直接看到 usage、租赁、用户、待扣金额、待结算金额和积压时长。
- 支付充值配置巡检发现生产 mock 充值或禁用充值时，管理员可以一键打开余额列表、余额流水和售出情况；如果 issue 带 `walletTransactionType=recharge`，余额流水会直接筛选充值类型。
- 账务对账巡检发现用量扣费、钱包流水、供给方结算或提现分配不一致时，会把 `reconciliation.detail.issues` 暴露到统一问题样本；`refType=usage` 可打开用量，`refType=wallet_transaction` 可打开具体余额流水，`refType=settlement` 可打开结算，`refType=withdrawal` 可打开提现。
- 余额账户巡检发现可用余额或冻结余额为负数时，会把 `wallets.detail.issues` 暴露到统一问题样本；样本包含 `walletId`、`walletAccountId`、`userId`、`userEmail`、`userStatus`、`availableBalance` 和 `frozenBalance`，管理员可直接打开异常钱包或用户详情。
- 反代请求巡检发现 4xx、5xx、本地错误、客户端断开或上游流异常时，管理员可以从巡检页一键进入对应请求日志，查看状态码、上游状态码、上游 request id、错误码、模型、路径、耗时和关联租赁/Key。
- 资源凭据巡检发现可应用候选时，管理员可以直接看到共享资源 ID、Sub2 账号 ID、供给方邮箱、凭据类型、状态、指纹和轮换时间。
- 资源凭据巡检发现没有 active 可应用 refresh token 时，会从 Sub2/OpenAI 巡检结果中暴露 `sub2_account_repair_candidate`，让管理员直接看到可优先补 token 的 Sub2 账号 ID、名称、状态、凭据状态和调度状态。
- 资源凭据巡检的 `openai_refresh_token_candidate_missing` 问题会同时暴露 `resourceList=true`、`resourceScope=production`、`resourceType=codex` 和 `sub2Status=true`，管理员可以在同一行进入生产共享资源列表创建/补凭据，或进入反代状态页直接应用 fresh token。
- 问题样本和候选样本摘要会展示 `repairAction`，例如 `apply_openai_refresh_token_to_sub2_account`，让管理员在点击共享资源或反代状态之前即可知道下一步维修动作。
- 共享资源巡检发现没有 online Codex 资源或存在异常资源时，管理员可以直接看到资源类型、资源状态、Sub2 账号、供给方邮箱和维修建议，并一键打开共享资源列表或具体资源详情。
- 如果共享资源问题样本带有 `resourceType` 和 `resourceStatus`，点击“打开共享资源”会自动把这些字段写入共享资源列表筛选条件，例如直接打开 `codex + disabled` 的资源列表。
- 如果共享资源或资源凭据问题样本带有 `resourceScope=production`，点击“打开共享资源”会写入隐藏筛选 `action=production`，只打开生产资源范围，排除内部 smoke / disabled 自检资源；普通共享资源列表不带该参数时仍可审计内部资源。
- 如果共享资源或资源凭据问题样本同时带有 `sub2AccountId`，点击“打开共享资源”会把资源创建表单的 Sub2 账号 ID 预填为该值，减少创建生产 Codex 资源时的手工复制。
- 当 `codex_online_resource_missing` 没有具体资源绑定但 Sub2/OpenAI 上游巡检发现可修复账号时，共享资源问题会继承首个修复候选的 `sub2AccountId`、账号状态、凭据状态和 `repairAction=apply_openai_refresh_token_to_sub2_account`，创建生产 Codex 资源时可直接预填该账号。
- 当 `codex_online_resource_missing` 没有具体资源绑定且系统只有一个 active 用户关联的供给方时，共享资源问题会附带该 `supplierEmail`；点击“打开共享资源”会用该邮箱筛选列表，并把创建表单的供给方邮箱预填为该值。
- 管理员可以从候选样本一键进入共享资源详情，继续执行凭据轮换、应用到 Sub2 或资源测试。
- 支付充值巡检会在 `detail.samples` 返回最近 5 条充值流水样本，管理员可以直接看到用户、钱包、金额、充值后余额、引用对象和创建时间，并一键打开用户、余额、余额流水或售出情况。
- Sub2/OpenAI 上游巡检发现网关不可达、OpenAI 分组缺失、分组非 active、分组无账号或无 active 账号时，管理员可以在统一问题样本中看到阻断原因、分组、OpenAI 账号数量、active 账号数量和维修建议，并一键进入反代状态页继续执行账号刷新、测试、自检或凭据应用。
- 当 Sub2/OpenAI 上游问题是 `openai_group_has_no_active_accounts` 且巡检已经发现非 active 或不可调度的 OpenAI 账号时，主问题样本会携带首个修复候选的 `sub2AccountId`、账号状态、凭据状态和 `repairAction=apply_openai_refresh_token_to_sub2_account`；点击 `打开反代状态` 会直接预选该账号。
- Sub2/OpenAI 上游巡检还会在候选样本中列出非 active 或不可调度的 OpenAI 账号，管理员可以直接看到账号 ID、名称、状态、凭据配置状态、调度状态和错误摘要；点击 `打开反代状态` 时会携带 `sub2AccountId`，反代状态页的凭据应用表单会预选该账号。
- 本地反代自检巡检发现最近 smoke 失败、跳过、过期或缺失时，管理员可以看到模型、跳过原因、`/v1/models`、`/v1/responses`、本地代理清理、临时 Key 禁用、代理日志数量、主请求日志和可选上游 request id，并可一键打开对应审计记录和反代状态页；如果 smoke 由资源凭据应用触发，会带上对应 `resourceId`；如果由 Sub2 直接应用 refresh token 触发，会带上对应 `sub2AccountId`，并在同步保存共享资源凭据时带上 `resourceId`。
- 如果本地反代自检问题与 Sub2/OpenAI 上游无 active 账号同时存在，smoke 问题会继承首个修复候选的 `sub2AccountId`、账号状态、凭据状态和 `repairAction=apply_openai_refresh_token_to_sub2_account`；点击 `打开反代状态` 会直接预选该账号。
- 管理员可以从巡检问题样本一键进入对应的用户、余额、售出订单、租赁、Key、用量、商品、结算、提现、反代状态、审计记录或反代请求列表，减少在可用性巡检和各运营页面之间手动复制 ID 的时间。
- 订单状态巡检发现 `failed` 或 `refunding` 订单时，会把具体订单作为问题样本暴露；`failed_order_retry_candidate` 可直接打开订单详情继续执行失败订单 `Retry`，`failed_order_manual_review` 会提示阻塞原因。
- 管理前端入口巡检发现必需管理范围缺失、列表型页面没有侧边栏入口或 view 重复时，会以 `adminSurfaceCoverage.detail.issues` 返回 `areaId`、`view`、`refId` 和维修建议，避免管理员入口退化只靠人工点击发现。

## 验收方式

- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/admin run build`
