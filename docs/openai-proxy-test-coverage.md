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
- `/v1` 本身和 `/api/admin/*` 不属于该 catch-all 反代范围。

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
