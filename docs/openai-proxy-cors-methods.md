# OpenAI/Codex 反代 CORS 方法契约

实现日期：2026-06-12

## 背景

本地 `/v1/*` OpenAI/Codex 反代支持 `GET`、`HEAD`、`POST`、`PUT`、`PATCH` 和 `DELETE`。这些方法覆盖模型查询、Responses 资源读取、响应取消或删除、以及 OpenAI 兼容客户端可能发起的后续管理型请求。

此前 Fastify CORS preflight 实测可以返回完整方法集合，但该行为依赖 `@fastify/cors` 默认值。为了避免依赖升级或配置调整后浏览器端 `PATCH`、`PUT`、`DELETE` 请求被 OPTIONS 预检拦截，CORS allow-methods 现在显式复用本地反代路由常量。

## 已实现能力

- `buildApiCorsOptions()` 的 `methods` 显式使用 `openAiProxyRouteMethods`。
- `inspectApiCorsPolicy()` 的摘要新增：
  - `allowedMethods=GET,HEAD,POST,PUT,PATCH,DELETE`
- 新增测试 `api cors preflight allows every local OpenAI proxy route method`：
  - 对 `/v1/responses/:id` 发起 `OPTIONS` preflight。
  - 请求方法为 `PATCH`。
  - 请求头包含 `authorization, content-type`。
  - 断言响应 `204`。
  - 断言 `access-control-allow-methods` 与 `openAiProxyRouteMethods` 完全一致。

## 管理员价值

- 浏览器端 OpenAI/Codex 兼容客户端不再只依赖库默认 CORS 行为。
- 反代路由方法、系统巡检摘要和 CORS preflight 响应使用同一来源，减少配置漂移。
- `/v1/responses/:id`、`/v1/responses/:id/input_items` 等非 POST 场景的浏览器调用路径更稳定。

## 验证命令

```bash
pnpm.cmd --filter @zyz/api run typecheck
pnpm.cmd --filter @zyz/api test
pnpm.cmd build
```
