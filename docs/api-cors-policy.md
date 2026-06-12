# API CORS 白名单策略

实现日期：2026-06-11

## 背景

生产环境此前使用 `origin: true`，会反射任意浏览器 Origin。虽然接口仍有鉴权，但这不符合生产前安全要求，也不利于管理员判断浏览器端调用边界。本次将 API CORS 收敛为生产白名单，同时保留开发和测试环境的便利性。

## 已实现范围

- 非生产环境继续允许任意 Origin，方便本地开发、测试和临时调试。
- 生产环境只允许白名单 Origin。
- 白名单来源：
  - `CORS_ALLOWED_ORIGINS`
  - `APP_PUBLIC_URL`
  - `ADMIN_PUBLIC_URL`
  - `API_PUBLIC_URL`
  - `OPENAI_PROXY_PUBLIC_ENDPOINT` 的 origin
- `CORS_ALLOWED_ORIGINS` 使用英文逗号分隔完整 origin，例如：

```env
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,https://api.example.com
```

- 生产环境显式拒绝 `*`，避免恢复任意 Origin。
- `Access-Control-Allow-Methods` 显式复用本地 OpenAI/Codex 反代方法集合：`GET,HEAD,POST,PUT,PATCH,DELETE`。
- API 仍通过 `Access-Control-Expose-Headers` 暴露本地 `x-proxy-request-id`、常见上游 request id、`retry-after` 和 `x-ratelimit-*` 响应头，方便浏览器端排障 OpenAI/Codex 反代请求与限流状态。
- `GET /api/admin/system-health` 新增 `corsPolicy` 检查项：
  - 生产环境没有可解析白名单时标记 error。
  - 生产环境配置 `*` 时标记 error。
  - 无效 URL 会作为 warning issue 返回。
  - metrics 会展示是否 enforce、白名单数量、配置数量、无效数量、允许方法和暴露头。

## 管理员价值

- 管理员可以在可用性巡检里确认生产 API 不再接受任意 Origin。
- 当后台或用户端域名新增时，可通过 `CORS_ALLOWED_ORIGINS` 明确扩展，不需要改代码。
- 浏览器端 OpenAI/Codex 客户端可以对 `/v1/*` 使用和本地反代路由一致的方法集合，不会因为 CORS preflight 与代理路由漂移而失败。
- 浏览器端仍能读取 `x-proxy-request-id`；如果上游返回 request id、重试间隔或 rate limit 余量，也能一并读取，不会牺牲反代排障体验。

## 验证方式

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/api test`
- `pnpm.cmd --filter @zyz/api run build`

## 2026-06-13 追加：本地限流头与 CORS 暴露闭环

- CORS 暴露头继续覆盖 `retry-after`、`retry-after-ms` 与常见 `x-ratelimit-*`，浏览器端 JavaScript 可以读取本地或上游返回的限流信息。
- 本地 OpenAI/Codex 反代自身产生的 429 现在也会实际写出限流头：
  - 并发耗尽返回重试间隔。
  - RPM/TPM 耗尽返回重试间隔、限制值和剩余额度。
  - 套餐请求量耗尽返回请求量限制和剩余 0。
- `openAiProxyContract.metrics` 同时暴露 `corsExposesRateLimitHeaders` 与 `setsLocalRateLimitHeaders`，用于区分“浏览器可读”与“本地 429 会写出”两个契约。
