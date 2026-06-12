# 反代请求日志

实现日期：2026-06-10

## 背景

OpenAI/Codex `/v1/*` 反代已经具备本地 Key 校验、租赁状态校验、余额护栏、并发限制、RPM/TPM 限制、超时保护和 Sub2API 透传能力。为了让管理员能够系统性复查反代可用性，本次新增持久化请求日志，把本地准入失败、上游响应状态和请求元数据集中展示出来。

## 数据模型

新增模型：`ProxyRequestLog`

关键字段：

- `requestId`：Fastify 请求 ID，便于和服务日志关联。
- `userId` / `rentalId` / `apiKeyId` / `apiKeyPrefix`：本地用户、租赁和 Key 追踪信息。
- `method` / `path`：OpenAI 兼容路径。
- `model`：客户端请求体顶层 `model` 字段；支持 JSON 顶层字段和 multipart/form-data 的 `model` part；无效 JSON、缺失字段或无法识别时为空。
- `statusCode`：最终返回给客户端的状态码。
- `upstreamStatusCode`：Sub2API 上游状态码，本地拦截时为空。
- `upstreamRequestId`：Sub2API/OpenAI 响应头中的上游 request id，本地拦截或上游未返回时为空。
- `errorCode`：本地拦截、上游不可用或流式响应异常的错误码。
- `durationMs`：非流式请求记录完整处理耗时；流式请求会先在上游响应头返回时落库，并在响应流结束、错误或客户端断开后回写完整持续时间。
- `requestBytes`：请求体字节数。
- `estimatedInputTokens`：本地限流使用的粗略输入 token 估算。
- `ipAddress` / `userAgent`：排障来源信息。

安全边界：

- 不保存请求体。
- 不保存响应体。
- 不保存 API Key 明文。
- 仅保存本地已经存在的 `keyPrefix`。
- 仅从请求体中提取顶层 `model` 字符串或 multipart `model` part，不保存 prompt、messages、input、文件内容或工具参数。

## 后端能力

- 反代入口对以下场景写入日志：
  - 缺少 Bearer Key。
  - Key 无效或已停用。
  - 用户、租赁、余额、资源类型、到期时间、请求量、RPM、TPM、并发等本地准入失败。
  - Sub2API 上游超时或不可用。
  - Sub2API 正常返回，包括 2xx、4xx、5xx。
- Sub2API/OpenAI 上游返回 HTTP `>=400` 时，日志会写入 `errorCode=upstream_http_<status>`，例如 `upstream_http_429` 或 `upstream_http_500`，便于后台按错误码筛选。
- Sub2API/OpenAI 上游返回常见 request id 响应头时，日志会写入 `upstreamRequestId`，便于跨系统关联上游日志。
- 流式响应结束后会回写同一条日志的 `durationMs`。
- 客户端在流式响应中途断开时，同一条日志会写入 `errorCode=client_disconnected`。
- 日志写入失败不会阻断用户请求，只记录服务端 warning。
- 新增管理员接口：`GET /api/admin/proxy-requests`
- 权限要求：`operator` 或 `admin`
- 支持分页、状态码过滤、错误码过滤和关键词搜索。
- 关键词搜索支持模型名和 `upstreamRequestId`。
- 关键词搜索支持直接粘贴本地或上游 request id 响应头，例如：
  - `x-proxy-request-id: <requestId>`
  - `x-request-id=<requestId>`
  - `openai-request-id: <requestId>`
  - `x-openai-request-id: <requestId>`
  - `request-id: <requestId>`

## 管理员入口

管理后台新增侧边栏入口：`反代请求`。

列表展示：

- 用户邮箱、本地请求 ID 与上游 request id。
- 请求 ID 单独成列，并提供复制按钮；如果存在上游 request id，会在同一列展示。
- 租赁或商品信息。
- API Key 名称或前缀。
- HTTP 方法与路径。
- 模型名。
- 客户端状态码与上游状态码。
- 错误码。
- 耗时、请求字节数、估算输入 token。
- IP、User-Agent、创建时间。

页面支持按当前筛选条件导出全部 CSV，便于线上排障时交叉比对服务日志、Sub2API 状态和用户反馈。

CSV 导出包含 `model` 和 `upstreamRequestId` 列，便于管理员按模型、上游错误和上游 request id 交叉排查。

管理员拿到用户反馈的 `x-proxy-request-id` 或上游 OpenAI/Sub2API request id 后，可以直接粘贴完整响应头行到搜索框定位日志。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 Prisma generate | 通过 |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |

## 2026-06-12 扩展：模型字段来源补齐

`ProxyRequestLog.model` 在 JSON 顶层字段和 multipart `model` part 之外，继续补齐以下低敏来源：

- `application/x-www-form-urlencoded` 请求体中的 `model` 字段。
- URL query 中的 `model` 参数，例如 `/v1/responses?model=gpt-5.3-codex`。
- 模型元数据路径 `/v1/models/:model`。

安全边界保持不变：不保存请求体、响应体、API Key 明文、prompt、messages、input、文件内容或工具参数。`text/plain` 等非表单请求体不会按 form-urlencoded 解析，避免误把 prompt 文本中的 `model=` 当作模型名。

## 2026-06-13 扩展：上游 request id 响应头搜索

反代请求搜索的响应头规范化范围进一步对齐 CORS 暴露头：

- 支持 `x-proxy-request-id`。
- 支持 `x-request-id`。
- 支持 `openai-request-id`。
- 支持 `x-openai-request-id`。
- 支持 `request-id`。

`GET /api/admin/system-health` 的 `openAiProxyContract` 巡检摘要新增：

- `proxyRequestLookupHeaders`
- `normalizesProxyRequestLookupHeaders`

当任一已暴露 request id 响应头无法被后台搜索框规范化时，巡检会返回 `proxy_request_lookup_header_normalization_incomplete`。

这样管理员拿到浏览器、SDK、Sub2API 或 OpenAI 返回的任一种 request id 响应头，都可以直接粘贴到 `反代请求` 页面定位本地日志。

## 2026-06-13 扩展：健康巡检异常分类

`ProxyRequestLog` 仍完整记录本地准入拒绝、上游 HTTP 错误、本地可用性错误、客户端断开和流式异常，但 `GET /api/admin/system-health` 的 `proxy` 检查会区分展示：

- `proxyRecentClientErrors`：全部 4xx。
- `proxyRecentClientRejections`：缺少/无效 Key、余额不足、租赁不可用、限流等本地准入拒绝。
- `proxyRecentActionableClientErrors`：需要管理员复查的 4xx，不包含本地准入拒绝。
- `proxyRecentLocalErrors`：本地可用性错误，例如 limiter 不可用、Sub2API 超时或不可达。

只有本地准入拒绝时，`proxy.status` 保持 `ok`；真正的需复查 4xx、5xx、本地可用性错误、客户端断开和上游流异常仍会进入健康问题样本，并可跳转回 `反代请求` 页面定位日志。

## 2026-06-13 扩展：Dashboard 阻断卡片携带日志筛选

`GET /api/admin/dashboard` 的关键阻断摘要现在会把反代日志定位字段带到首页：

- `latestSystemHealth.upstreamBlocker.proxyRequestFilterLookup`
- `latestSystemHealth.upstreamBlocker.proxyRequestFilterStatus`
- `latestSystemHealth.deliveryBlocker.proxyRequestFilterLookup`
- `latestSystemHealth.deliveryBlocker.proxyRequestFilterStatus`

映射规则：

- 精确 request/log/upstream id 优先作为 lookup 搜索。
- 上游 HTTP 或 `upstream_*` 错误映射为 `upstream_error`。
- 本地准入拒绝映射为 `local_rejection`。
- 本地代理或上游可用性问题映射为 `local_availability`。
- stream 异常映射为 `stream_error`。
- 4xx / 5xx 分别映射为 `client_error` / `server_error`。

Admin 首页阻断卡片的“打开失败日志”会复用这些字段，让管理员从首屏直接进入相关反代请求日志集合。

## 2026-06-13 扩展：日志行携带 Sub2/OpenAI 修复入口

`反代请求` 列表现在会针对上游或代理可用性失败显示 `反代状态` 操作。

- 显示条件包括 `upstreamStatusCode >= 400`、`statusCode >= 500`、`upstream_*` 错误、上游超时/不可达和 stream 错误。
- 点击后会把当前日志的 request id、日志 id、上游 request id、路径、状态码、错误码和模型带入 `反代状态` 页。
- `/v1/responses` 失败会标记 `responsesOk=false`，帮助管理员应用凭据后直接执行 smoke 验收。
- `missing_api_key` 等本地准入拒绝不会显示该修复入口。

该入口把 Dashboard 阻断卡片、反代失败日志和 Sub2/OpenAI 凭据修复面板连成连续排障路径。

## 2026-06-13 扩展：租赁 Sub2 交付上下文

`GET /api/admin/proxy-requests` 的租赁关联返回继续补齐低敏交付字段：

- `rental.sub2UserId`
- `rental.sub2KeyId`
- `rental.endpointUrl`

这些字段用于管理员确认一次反代失败对应的售出租赁通道和 Sub2API 交付对象。搜索框支持按 Sub2 User ID、Sub2 Key ID 或 endpoint URL 定位日志，CSV 导出也包含 `sub2UserId`、`sub2KeyId` 和 `endpointUrl`。

当上游失败日志打开 `反代状态` 修复面板时，修复定位会展示租赁 ID、资源类型、endpoint、Sub2 用户和 Sub2 Key。安全边界保持不变：不保存请求体、响应体、API Key 明文、refresh token 明文、prompt、messages、input、文件内容或工具参数。

## 2026-06-13 扩展：失败日志追溯到共享资源

租赁现在会持久化 `supplierResourceId`，因此 `GET /api/admin/proxy-requests` 可以继续返回失败请求对应的共享资源上下文：

- `rental.supplierResourceId`
- `rental.supplierResource.sub2AccountId`
- `rental.supplierResource.status`
- `rental.supplierResource.supplier.user.email`

反代请求搜索支持按共享资源 ID、Sub2 Account ID 或供给方邮箱定位日志。列表行新增资源直达操作，CSV 导出新增共享资源、Sub2 Account ID 和供给方邮箱列。

当上游失败日志打开 `反代状态` 修复面板时，修复上下文会优先带入共享资源 ID、Sub2 Account ID、资源状态和供给方邮箱，让管理员可以直接对准关联 Sub2/OpenAI 上游账号执行 refresh token 修复和 smoke 验收。
