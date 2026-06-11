# 本地反代自检请求日志定位

实现日期：2026-06-12

## 背景

管理员已经可以在 `反代状态` 页运行 `POST /api/admin/sub2/proxy-smoke-test`，真实穿过本地租赁、钱包、API Key、`/v1/models`、`/v1/responses`、ProxyRequestLog 和 Sub2API 上游。此前系统巡检只展示代理日志数量，`/v1/responses` 失败时仍需要管理员手动到反代请求列表里搜索对应 smoke 租赁或审计记录。

本次补强把 smoke 产生的具体代理请求日志摘要写入自检结果和审计日志，并让 `localProxySmoke` 巡检问题样本直接携带可跳转字段。

## 已实现范围

- `runLocalOpenAiProxySmokeTest()` 在统计 smoke 代理日志数量时，同步读取最多 5 条本次 smoke 租赁关联的 `ProxyRequestLog` 摘要。
- `POST /api/admin/sub2/proxy-smoke-test` 的 `localProxy.proxyRequestLogs[]` 新增以下字段：
  - `id`
  - `requestId`
  - `path`
  - `model`
  - `statusCode`
  - `upstreamStatusCode`
  - `errorCode`
  - `createdAt`
- 审计日志 `admin.sub2.proxy_smoke_test` 和资源凭据应用审计中的 `smokeTest.localProxy` 会保留上述摘要。
- `GET /api/admin/system-health` 的 `localProxySmoke.detail.latest` 会返回：
  - `proxyRequestLogs`
  - `proxyRequestLogId`
  - `requestId`
  - `proxyRequestPath`
  - `proxyRequestStatusCode`
  - `proxyRequestErrorCode`
- `localProxySmoke.detail.issues[]` 会把同样的主请求定位字段暴露给管理员后台。
- 主请求选择规则：
  - 优先选择带 `errorCode` 或 `statusCode >= 400` 的代理日志。
  - 如果没有失败日志，则选择最近一条 smoke 代理日志。
- 管理后台 `可用性巡检 -> 巡检问题样本` 已有通用 `requestId` / `proxyRequestLogId` 跳转逻辑；因此 smoke 问题现在可以一键打开对应反代请求日志。
- 问题样本的对象摘要新增 `proxyRequestPath`、`proxyRequestStatusCode`、`proxyRequestErrorCode`，管理员点开前即可看到失败路径和状态码。

## 管理员价值

- 当 `/v1/responses` 失败时，管理员可以从系统巡检直接进入对应 `ProxyRequestLog`，查看状态码、上游状态码、错误码、模型、路径、耗时、Key 和租赁关联。
- 当 smoke 由资源凭据应用触发时，问题样本同时保留 `resourceId` 和代理请求日志定位字段，便于在资源详情与请求日志之间往返排障。
- 当上游 OpenAI refresh token 失效时，巡检仍会明确展示失败发生在本地反代的哪一次请求，避免把 Sub2/OpenAI 上游凭据问题误判为本地代理链路无日志。

## 验证方式

本地验证：

- `npm.cmd test`
- `npm.cmd run typecheck` in `user/apps/api`
- `npm.cmd run typecheck` in `user/apps/admin`
- `npm.cmd run build` in `user/apps/api`
- `npm.cmd run build` in `user/apps/admin`

线上验证：

1. 部署包含本能力的 release。
2. 管理员登录后台，进入 `反代状态`，运行端到端自检。
3. 打开 `可用性巡检`，确认 `localProxySmoke` 的问题样本或 latest 证据包含 `requestId`、`proxyRequestLogId` 和代理路径字段。
4. 点击 `打开反代请求`，确认反代请求列表可定位到本次 smoke 的 `/v1/models` 或 `/v1/responses` 请求。
