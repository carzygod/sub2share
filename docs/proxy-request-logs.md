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
