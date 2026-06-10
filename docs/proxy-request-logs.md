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
- `statusCode`：最终返回给客户端的状态码。
- `upstreamStatusCode`：Sub2API 上游状态码，本地拦截时为空。
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

## 后端能力

- 反代入口对以下场景写入日志：
  - 缺少 Bearer Key。
  - Key 无效或已停用。
  - 用户、租赁、余额、资源类型、到期时间、请求量、RPM、TPM、并发等本地准入失败。
  - Sub2API 上游超时或不可用。
  - Sub2API 正常返回，包括 2xx、4xx、5xx。
- Sub2API/OpenAI 上游返回 HTTP `>=400` 时，日志会写入 `errorCode=upstream_http_<status>`，例如 `upstream_http_429` 或 `upstream_http_500`，便于后台按错误码筛选。
- 流式响应结束后会回写同一条日志的 `durationMs`。
- 客户端在流式响应中途断开时，同一条日志会写入 `errorCode=client_disconnected`。
- 日志写入失败不会阻断用户请求，只记录服务端 warning。
- 新增管理员接口：`GET /api/admin/proxy-requests`
- 权限要求：`operator` 或 `admin`
- 支持分页、状态码过滤、错误码过滤和关键词搜索。
- 关键词搜索支持直接粘贴 `x-proxy-request-id: <requestId>` 或 `x-request-id=<requestId>` 形式的响应头。

## 管理员入口

管理后台新增侧边栏入口：`反代请求`。

列表展示：

- 用户邮箱与请求 ID。
- 请求 ID 单独成列，并提供复制按钮。
- 租赁或商品信息。
- API Key 名称或前缀。
- HTTP 方法与路径。
- 客户端状态码与上游状态码。
- 错误码。
- 耗时、请求字节数、估算输入 token。
- IP、User-Agent、创建时间。

页面支持按当前筛选条件导出全部 CSV，便于线上排障时交叉比对服务日志、Sub2API 状态和用户反馈。

管理员拿到用户反馈的 `x-proxy-request-id` 后，可以直接粘贴完整响应头行到搜索框定位日志。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 Prisma generate | 通过 |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
