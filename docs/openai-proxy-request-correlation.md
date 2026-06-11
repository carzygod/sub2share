# OpenAI/Codex 反代请求关联 ID

实现日期：2026-06-10

## 背景

管理员后台已经可以通过 `ProxyRequestLog.requestId` 搜索本地 `/v1/*` 反代请求，但此前 `x-proxy-request-id` 主要覆盖成功转发到 Sub2API 后的响应。本地缺 Key、Key 无效、余额不足、租赁失效、限额、速率或并发拦截时，用户侧错误响应可能缺少可回报给管理员的请求 ID。

## 已实现能力

- `/v1/*` 代理入口会在处理开始时写入 `x-proxy-request-id`。
- 本地准入失败、余额失败、租赁失败、请求量/RPM/TPM/并发失败和上游异常响应都会带上同一个请求 ID。
- 成功转发到 Sub2API 后，系统仍会在复制上游响应头之后重新写入本地 `x-proxy-request-id`，避免上游同名响应头覆盖本地关联 ID。
- `x-proxy-request-id` 与 `ProxyRequestLog.requestId` 保持一致，可在管理员 `反代请求` 页面搜索。
- 管理员 `反代请求` 接口会归一化搜索关键词，支持直接粘贴 `x-proxy-request-id: <requestId>` 或 `x-request-id=<requestId>`。
- 管理后台 `反代请求` 表格将请求 ID 单独展示，并提供复制按钮。
- API CORS 配置通过 `Access-Control-Expose-Headers` 暴露 `x-proxy-request-id`，浏览器端 JavaScript 也可以读取该响应头。
- CORS 选项集中在 `user/apps/api/src/common/cors.ts`，并通过 Fastify 注入测试验证真实响应头。

## 管理员价值

- 用户只要提供响应头中的 `x-proxy-request-id`，管理员就能定位对应本地代理日志。
- 浏览器集成方无需打开开发者工具，也可以在代码里读取 `x-proxy-request-id` 并展示给用户或写入工单。
- 管理员无需手工裁剪响应头，可以直接粘贴搜索并复制日志中的请求 ID。
- 本地拦截和上游失败都能进入同一排查方式，减少售后排障时反复询问 Key、时间和路径的成本。
- 该能力补齐 OpenAI/Codex 反代链路的可观测性闭环。

## 2026-06-12 扩展

- `ProxyRequestLog` 新增 `upstreamRequestId`，用于保存 Sub2API/OpenAI 响应头中的上游 request id。
- 管理员 `反代请求` 搜索、列表和 CSV 导出支持上游 request id。
- API CORS 暴露头除 `x-proxy-request-id` 外，也暴露 `x-request-id`、`openai-request-id`、`x-openai-request-id` 和 `request-id`。
- 详细说明见 `docs/proxy-request-upstream-request-id.md`。
