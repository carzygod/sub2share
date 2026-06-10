# OpenAI/Codex 反代本地错误类型兼容

实现日期：2026-06-10

## 背景

本地 `/v1/*` 反代入口会在转发到 Sub2API 前执行 API Key、用户、余额、租赁、请求量、RPM/TPM、并发和上游连通性校验。此前这些本地错误虽然保留了 HTTP 状态码和业务 `code`，但 `error.type` 统一返回 `invalid_request_error`，会让 OpenAI 风格客户端难以按余额、限流和上游异常做分流处理。

## 已实现能力

- 新增 `openAiProxyErrorType()`，集中维护本地代理错误到 OpenAI 风格 `error.type` 的映射。
- 新增 `openAiProxyErrorPayload()`，统一生成本地拦截错误 payload。
- `/v1/*` 路由继续保留原 HTTP 状态码、`error.code` 和 `error.message`，只细化 `error.type`。
- 401/403 等认证、权限、租赁状态错误返回 `invalid_request_error`。
- 402 余额不足和花费额度耗尽返回 `insufficient_quota`。
- 429 请求量、RPM/TPM 和并发限制返回 `rate_limit_error`。
- 502/504 上游不可用或超时返回 `api_error`。
- 新增 Node test 覆盖类型映射和 payload 结构，避免后续网关错误格式回归。
- `GET /api/admin/system-health` 新增 `openAiProxyContract` 检查项，会验证公开 endpoint、CORS 请求 ID 暴露头和关键本地错误类型映射。

## 管理员价值

- 用户侧 SDK 或集成方可以按 `error.type` 区分余额问题、限流问题和上游可用性问题。
- 管理员排障时仍可依赖原有 `error.code`、HTTP 状态码和 `x-proxy-request-id` 精确定位。
- 管理员可以在 `可用性巡检` 中提前发现反代契约配置或本地错误结构回归。
- 该能力提升 OpenAI/Codex 反代入口对通用 OpenAI 客户端的兼容性，同时不改变已有业务错误码。

## 验收方式

```bash
npm --prefix user/apps/api test
npm --prefix user/apps/api run typecheck
npm --prefix user/apps/api run build
```
