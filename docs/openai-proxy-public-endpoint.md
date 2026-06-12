# OpenAI/Codex 反代公开 Endpoint 配置

实现日期：2026-06-10

## 背景

售出的 Codex/OpenAI 租赁会把 `Rental.endpointUrl` 返回给用户，后台本地端到端自检也会通过该公开 endpoint 调用 `/v1/models` 和 `/v1/responses`。如果该地址错误地指向前端站点而不是 API 服务，用户会拿到不可用的 OpenAI 兼容入口，自检也无法证明本地反代链路可用。

## 解析规则

`openAiProxyPublicEndpoint` 的解析优先级：

1. `OPENAI_PROXY_PUBLIC_ENDPOINT`
2. `API_PUBLIC_URL + /v1`
3. 非生产环境默认 `http://localhost:${API_PORT}/v1`

生产环境如果没有配置 `OPENAI_PROXY_PUBLIC_ENDPOINT` 或 `API_PUBLIC_URL`，API 服务会启动失败，并提示：

```text
Either OPENAI_PROXY_PUBLIC_ENDPOINT or API_PUBLIC_URL must be configured in production
```

## 配置建议

生产环境应显式配置：

```env
API_PUBLIC_URL=https://api.example.com
OPENAI_PROXY_PUBLIC_ENDPOINT=https://api.example.com/v1
```

如果前端和 API 使用同一个域名，也应明确把 `API_PUBLIC_URL` 配置为该公开 API origin，而不是依赖 `APP_PUBLIC_URL` 推导。

## 影响范围

- 新订单交付的 `Rental.endpointUrl`。
- API Key 轮换后写回的 `Rental.endpointUrl`。
- 管理后台 `反代状态 -> 端到端自检` 使用的本地代理 endpoint。
- Sub2 Key 开通结果中返回给业务系统的 endpoint。
- 精确访问 `endpointUrl` 对应的 `/v1` 基路径时，也会进入本地 OpenAI/Codex 反代门禁并转发到 Sub2API。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/api test`

线上验证建议：

1. 确认生产 `.env` 中存在 `OPENAI_PROXY_PUBLIC_ENDPOINT` 或 `API_PUBLIC_URL`。
2. 创建一笔 Codex/OpenAI 租赁。
3. 确认订单返回的 `endpointUrl` 指向 API 服务的 `/v1`。
4. 使用售出的 Key 请求 `${endpointUrl}/models`，预期进入本系统反代并返回 `x-proxy-request-id`；如果 Sub2API/OpenAI 返回上游 request id，后台 `反代请求` 日志会记录为 `upstreamRequestId`。
5. 使用售出的 Key 请求 `${endpointUrl}` 或 `${endpointUrl}/`，预期不会被本地 API 404 提前截断，而是进入本系统反代并返回 `x-proxy-request-id`。
6. 浏览器端调用时确认响应包含 `Access-Control-Expose-Headers`，且前端代码可读取 `x-proxy-request-id` 和常见上游 request id 响应头。
7. 在后台运行 `反代状态 -> 端到端自检`，确认 `localProxy.endpoint` 与生产 API `/v1` 一致。
