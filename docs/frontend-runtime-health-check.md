# 前端入口运行态巡检

实现日期：2026-06-12

## 背景

线上曾出现 API 仍然健康，但 Web/Admin 前端端口短暂通过部署检查后停止监听的问题。部署脚本已经改为 systemd 管理的 Node 静态服务，但系统健康页此前只检查 API release 运行态，没有独立证明用户前台和管理员后台入口可访问。

## 已实现范围

- `GET /api/admin/system-health` 新增 `frontendRuntime` / `前端入口` 检查项。
- API 进程会探测：
  - `APP_PUBLIC_URL`
  - `ADMIN_PUBLIC_URL`
- 每个端点最多等待 `3000ms`。
- 成功条件：
  - HTTP 状态码为 `2xx` 或 `3xx`。
  - `Content-Type` 包含 `text/html`。
- 缺少 URL 配置会标记为 `warning`。
- 端点不可达、返回错误状态码、返回非 HTML 会标记为 `error`。

## 返回字段

`frontendRuntime.metrics`：

- `totalEndpoints`
- `okEndpoints`
- `missingEndpoints`
- `failedEndpoints`
- `nonHtmlEndpoints`

`frontendRuntime.detail.probes[]`：

- `endpoint`
- `url`
- `ok`
- `statusCode`
- `contentType`
- `durationMs`
- `error`

`frontendRuntime.detail.issues[]`：

- `type`
- `severity`
- `endpoint`
- `endpointUrl`
- `statusCode`
- `contentType`
- `durationMs`
- `error`
- `message`
- `actionHint`

管理后台 `可用性巡检 -> 巡检问题样本` 已将 `endpoint`、`endpointUrl`、`statusCode`、`contentType`、`durationMs` 纳入对象摘要，便于管理员直接看到哪个前端入口不可用。

## 管理员价值

- API 正常但 Web/Admin 不可访问时，健康页可以直接报出前端入口异常。
- 如果 Web/Admin 被错误路由到 JSON/API、空白服务或反向代理错误页，非 HTML 或错误状态码会被明确标记。
- 与部署运行态巡检配合后，管理员能同时确认：
  - API release marker 正确。
  - Web/Admin 入口真实返回前端 HTML。
  - 管理员入口能力矩阵仍完整覆盖用户、共享、余额和售出管理。

## 验证方式

本地验证：

- `npm.cmd test` in `user/apps/api`
- `npm.cmd run typecheck` in `user/apps/api`
- `npm.cmd run typecheck` in `user/apps/admin`
- `npm.cmd run build` in `user/apps/api`
- `npm.cmd run build` in `user/apps/admin`

线上验证：

1. 部署包含本能力的 release。
2. 登录管理员后台，读取 `GET /api/admin/system-health`。
3. 确认 `frontendRuntime.status=ok`。
4. 确认 `frontendRuntime.metrics.okEndpoints=2`。
5. 确认 `detail.probes` 中 Web/Admin 均为 `ok=true` 且 `contentType` 包含 `text/html`。
