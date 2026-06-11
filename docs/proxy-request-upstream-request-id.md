# 反代请求上游 Request ID 追踪

实现日期：2026-06-12

## 背景

本地 `/v1/*` OpenAI/Codex 反代已经会为每个请求生成 `x-proxy-request-id`，并在 `ProxyRequestLog` 中记录本地请求、租赁、Key、模型、HTTP 状态和错误码。实际排查 Sub2API 或 OpenAI 上游错误时，管理员还需要上游响应头中的 request id，才能把本地日志、Sub2 网关日志和上游供应侧排障串起来。

## 已实现能力

- `ProxyRequestLog` 新增 `upstreamRequestId String?` 字段。
- 新增迁移：

```text
user/prisma/migrations/0015_proxy_request_log_upstream_request_id/migration.sql
```

- `/v1/*` 成功收到 Sub2API 响应后，会按优先级提取上游 request id：
  - `x-request-id`
  - `openai-request-id`
  - `x-openai-request-id`
  - `request-id`
- 提取值会清理换行并截断到 240 字符。
- Fastify CORS `exposedHeaders` 现在同时暴露：
  - `x-proxy-request-id`
  - `x-request-id`
  - `openai-request-id`
  - `x-openai-request-id`
  - `request-id`
- `GET /api/admin/proxy-requests` 支持按 `upstreamRequestId` 搜索。
- Admin `反代请求` 列表会展示本地 request id 和上游 request id。
- 反代请求 CSV 导出新增 `upstreamRequestId` 列。
- `GET /api/admin/system-health` 的 `proxy` 异常样本新增 `upstreamRequestId`，问题摘要也会展示上游 request id。
- Admin `可用性巡检` 问题样本对象摘要支持 `upstreamRequestId`，并可用该值打开 `反代请求` 列表筛选。
- `POST /api/admin/sub2/proxy-smoke-test` 以及资源凭据应用/直接 token 应用触发的端到端 smoke 审计，会在 `localProxy.proxyRequestLogs[]` 中保留 `upstreamRequestId`。
- `localProxySmoke` 系统健康检查会把主失败请求的 `upstreamRequestId` 放入 latest 证据和问题样本。

## 管理员价值

- 管理员可以从用户反馈的 `x-proxy-request-id` 定位本地日志，也可以从上游错误里的 request id 反查本地请求。
- 当 `/v1/responses` 出现 `upstream_http_401`、`upstream_http_429`、`upstream_http_500` 或 `upstream_http_503` 时，可以把本地租赁/Key/模型和上游 request id 一起交给 Sub2API 或上游账号侧排障。
- 当端到端 smoke 在 `/v1/responses` 失败时，系统健康页也能直接展示该次 smoke 的上游 request id，不需要先进入反代请求列表再查。
- 浏览器客户端也能读取本地和上游 request id，减少前端集成问题只能靠服务端日志查找的情况。

## 安全边界

- 不记录请求体、响应体、明文 API Key 或 refresh token。
- `upstreamRequestId` 只用于排障关联，不作为账务、扣费或鉴权依据。
- 本地仍以 `x-proxy-request-id` 作为平台内主定位 ID；上游 request id 是跨系统辅助线索。
