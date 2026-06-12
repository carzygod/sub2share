# OpenAI/Codex 反代测试覆盖

实现日期：2026-06-10

## 背景

本地 `/v1/*` 反代承担售出 Key 的准入、余额、租赁、请求量、速率、并发和 Sub2API 透传。此前 API 包的 `test` 脚本只是占位，无法在改动代理规则后及时发现 `/v1/models` 元数据请求误计入套餐限制、`/v1/responses` 误被当成元数据请求、或请求体估算变化导致 TPM 闸门异常。

## 已实现能力

- 新增 `user/apps/api/src/modules/openai-proxy/helpers.ts`。
- 将反代元数据路径识别、请求体文本化、请求字节数统计和输入 token 粗估抽为纯 helper。
- `user/apps/api/package.json` 的 `test` 脚本改为真实执行 Node test runner。
- 新增 `user/apps/api/tests/openai-proxy-helpers.test.ts`。
- 测试覆盖：
  - `GET /v1/models`
  - `HEAD /v1/models?limit=20`
  - `GET /v1/models/:id`
  - 非元数据请求 `POST /v1/responses`、`POST /v1/chat/completions`
  - Buffer、字符串、JSON 对象请求体的 token 粗估和字节统计

## 2026-06-11 追补：完整 v1 反代路由契约

- 将本地反代运行路由显式化为共享常量：
  - `openAiProxyRoutePath = "/v1/*"`
  - `openAiProxyRouteMethods = GET, HEAD, POST, PUT, PATCH, DELETE`
- `registerOpenAiProxyRoutes()` 使用同一组常量注册 Fastify 路由，避免健康巡检和真实运行时漂移。
- `inspectOpenAiProxyContract()` 的健康指标新增：
  - `routePath`
  - `routeMethods`
  - `supportsAllV1ChildPaths`
  - `supportsReadMethods`
  - `supportsMutationMethods`
  - `routesResponsesApi`
  - `routesResponsesItems`
  - `routesChatCompletions`
  - `routesModelMetadata`
- 新增测试确认以下路径都属于本地 OpenAI/Codex 反代覆盖范围：
  - `/v1/responses`
  - `/v1/responses/:id`
  - `/v1/responses/:id/input_items`
  - `/v1/chat/completions`
  - `/v1/models/:id`
- `/api/admin/*` 不属于该 catch-all 反代范围；`/v1` 基路径已在 2026-06-12 追补中单独纳入本地反代入口。

## 验收命令

```bash
npm --prefix user/apps/api test
npm --prefix user/apps/api run typecheck
npm --prefix user/apps/api run build
```

本轮验证命令：

```bash
pnpm.cmd --filter @zyz/api run typecheck
pnpm.cmd --filter @zyz/api test
pnpm.cmd --filter @zyz/api run build
```

## 管理员价值

- 降低反代门禁规则后续改动时的回归风险。
- 确保模型列表等诊断型请求继续不消耗套餐请求数、RPM 和 TPM。
- 确保 Responses、Chat Completions 等真实生成请求继续进入本地风控和可观测链路。

## 2026-06-12 追补：反代运行契约可见化

- `inspectOpenAiProxyContract()` 支持接收生产运行参数：
  - `bodyLimitBytes`
  - `upstreamTimeoutMs`
  - `streamIdleTimeoutMs`
- 健康检查摘要会暴露反代请求体和流式转发关键策略：
  - 全内容类型按 raw buffer 接收。
  - GET/HEAD 不带请求体转发。
  - 非 GET/HEAD 请求保持原始字节转发给 Sub2API。
  - 上游请求使用 `accept-encoding: identity`。
  - 入站 `authorization` 会被剥离，并用本地售出 Key 重新注入到 Sub2API 请求。
  - 上游响应流完成、异常、客户端中断和空闲超时都会进入代理请求日志。
- 测试新增正常运行契约断言，并覆盖运行参数为非正整数时的 `error` 问题样本。

## 2026-06-12 追补：反代 CORS 方法契约

- API CORS 配置的 `methods` 显式复用 `openAiProxyRouteMethods`。
- `inspectApiCorsPolicy()` 摘要新增 `allowedMethods`，便于系统巡检展示浏览器端允许方法。
- `api-cors.test.ts` 新增 OPTIONS preflight 测试，覆盖：
  - URL：`/v1/responses/:id`
  - 请求方法：`PATCH`
  - 请求头：`authorization, content-type`
  - 响应：`204`
  - `access-control-allow-methods` 与 `GET,HEAD,POST,PUT,PATCH,DELETE` 完全一致。
- 该测试确保浏览器端 OpenAI/Codex 兼容客户端不会因为 CORS 默认方法漂移而无法调用非 POST 的 `/v1/*` 路径。

## 2026-06-12 追补：精确 `/v1` 基路径透传

- 本地反代路由从单一 `/v1/*` 扩展为：
  - `/v1`
  - `/v1/*`
- 两个路径共用同一套本地售出 Key 鉴权、余额准入、租赁状态检查、并发/RPM/TPM 限流、请求日志、上游 request id 捕获和 Sub2API 透传逻辑。
- `inspectOpenAiProxyContract()` 摘要新增：
  - `routePaths=/v1,/v1/*`
  - `supportsV1BasePath=true`
  - `routesV1BasePath=true`
- 单元测试确认 `/v1` 与 `/v1/` 都属于本地 OpenAI/Codex 反代范围，同时 `/v10/responses` 和 `/api/admin/*` 不会误入反代。

这项补齐让公开 endpoint `https://api.example.com/v1` 的基路径本身也能进入 Sub2API 代理链路；即使上游返回 404 或其他响应，也会产生本地代理请求 ID 和可审计日志，而不是被 API 服务自己的 404 提前截断。

## 2026-06-12 追补：本地错误 payload 结构契约

- 本地 OpenAI/Codex 反代拦截错误继续使用统一 `openAiProxyErrorPayload()`。
- 错误对象现在稳定包含：
  - `error.message`
  - `error.type`
  - `error.param`
  - `error.code`
- 本地无具体参数定位时，`error.param=null`。
- `inspectOpenAiProxyContract()` 摘要新增 `localErrorPayloadIncludesParam=true`。
- 单元测试覆盖 429 限流错误 payload 中的 `param: null`，并锁定系统健康契约会检查该字段。

该契约减少通用 OpenAI SDK 或调用方在解析本地拦截错误时遇到字段缺失的风险。

## 2026-06-13 追补：request id 响应头搜索契约

- 反代请求搜索规范化现在复用统一 `proxyRequestLookupHeaderNames`：
  - `x-proxy-request-id`
  - `x-request-id`
  - `openai-request-id`
  - `x-openai-request-id`
  - `request-id`
- 管理员可以直接粘贴上述完整响应头行到 `反代请求` 搜索框。
- `inspectOpenAiProxyContract()` 摘要新增：
  - `proxyRequestLookupHeaders`
  - `normalizesProxyRequestLookupHeaders`
- 单元测试覆盖每个响应头名称都能被规范化为纯 request id。

这项补齐让 CORS 暴露给浏览器和 SDK 的本地/上游 request id，都能进入同一套后台排障搜索口径。
