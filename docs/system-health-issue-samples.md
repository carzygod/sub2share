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
  - 对象：自动拼接 `requestId`、`proxyRequestLogId`、`auditLogId`、`auditAction`、`resourceId`、`productId`、`priceId`、`orderId`、`rentalId`、`apiKeyId`、`apiKeyPrefix`、`model`、`usageId`、`userId`、`walletId`、`walletAccountId`、`bindingId`、`sub2AccountId`、`sub2BlockingReason`、`sub2GroupId`、`sub2GroupName`、`sub2GroupStatus`、`openAiAccountCount`、`activeOpenAiAccountCount`、`gatewayReachable`、`settlementId`、`settlementRecordId`、`withdrawalId`、`refId`、`expected`、`actual` 等定位字段。
  - 说明：后端返回的 `message`，没有 message 时回退为紧凑 JSON；如果后端返回 `actionHint`，页面会追加展示维修建议。
  - 操作：如果样本包含可定位字段，可直接打开相应管理入口；当前支持资源、用户、订单、租赁、余额账户、API Key、用量、商品、结算、提现和反代请求日志。
- 候选样本展示字段：
  - 检查项：检查项名称和 ID。
  - 对象：复用问题样本的定位字段拼接规则。
  - 摘要：自动拼接 `supplierEmail`、`credentialType`、`status`、`resourceStatus`、`keyFingerprint`、`lastRotatedAt` 等摘要字段。
  - 操作：如果样本包含 `resourceId`，可直接打开共享资源详情。

## 管理价值

- 售出交付巡检发现缺租赁、缺 endpoint、缺 Sub2 Key、缺 active 本地 API Key 时，管理员可以直接看到受影响订单和租赁。
- API Key 可用性巡检发现钱包、租赁、Key hash、到期等准入问题时，管理员可以直接定位 Key、租赁和用户。
- OpenAI 反代契约巡检发现 endpoint、CORS 或错误类型问题时，管理员可以在同一页看到具体契约问题。
- 用量同步调度巡检发现生产环境禁用自动同步、间隔过长或启动后不立即同步时，管理员可以直接看到配置风险。
- Pending 用量账务巡检发现待恢复扣费 usage 时，管理员可以直接看到 usage、租赁、用户、待扣金额、待结算金额和积压时长。
- 反代请求巡检发现 4xx、5xx、本地错误、客户端断开或上游流异常时，管理员可以从巡检页一键进入对应请求日志，查看状态码、上游状态码、错误码、模型、路径、耗时和关联租赁/Key。
- 资源凭据巡检发现可应用候选时，管理员可以直接看到共享资源 ID、Sub2 账号 ID、供给方邮箱、凭据类型、状态、指纹和轮换时间。
- 管理员可以从候选样本一键进入共享资源详情，继续执行凭据轮换、应用到 Sub2 或资源测试。
- Sub2/OpenAI 上游巡检发现网关不可达、OpenAI 分组缺失、分组非 active、分组无账号或无 active 账号时，管理员可以在统一问题样本中看到阻断原因、分组、OpenAI 账号数量、active 账号数量和维修建议，并一键进入反代状态页继续执行账号刷新、测试、自检或凭据应用。
- 本地反代自检巡检发现最近 smoke 失败、过期或缺失时，管理员可以看到模型、`/v1/models`、`/v1/responses`、本地代理清理、临时 Key 禁用和代理日志数量，并可一键打开对应审计记录。
- 管理员可以从巡检问题样本一键进入对应的用户、余额、售出订单、租赁、Key、用量、商品、结算、提现、反代状态、审计记录或反代请求列表，减少在可用性巡检和各运营页面之间手动复制 ID 的时间。
- 订单状态巡检发现 `failed` 或 `refunding` 订单时，会把具体订单作为问题样本暴露；`failed_order_retry_candidate` 可直接打开订单详情继续执行失败订单 `Retry`，`failed_order_manual_review` 会提示阻塞原因。

## 验收方式

- `npm.cmd --prefix user/apps/admin run typecheck`
- `npm.cmd --prefix user/apps/admin run build`
