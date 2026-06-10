# OpenAI/Codex 反代流式断开保护

实现日期：2026-06-10

## 背景

`POST /v1/responses` 支持流式响应。此前本地代理在拿到 Sub2API 响应头后会清理客户端断开监听；如果用户在 streaming 过程中关闭连接，本地代理可能继续读取上游响应，浪费 Sub2API 并发与上游生成资源。

本次改造让客户端连接关闭能够贯穿到上游流读取阶段。

## 已实现范围

- `forwardToSub2` 返回上游 `Response`、`cleanup` 函数和 `abort` 函数。
- 上游响应头返回后，继续保留 `reply.raw.close` 监听。
- 当客户端在流式响应过程中断开时，通过 `AbortController` 中止上游 fetch。
- `HEAD` 请求或无响应体请求会立即清理监听。
- 有响应体时，清理动作绑定到 Node `Readable` 的 `end`、`error`、`close` 事件。
- `ProxyRequestLog.durationMs` 会在响应流结束、错误或客户端断开后回写为完整持续时间。
- 客户端中途断开时，`ProxyRequestLog.errorCode` 会回写为 `client_disconnected`。
- 上游流错误或异常关闭时，`ProxyRequestLog.errorCode` 会回写为 `upstream_stream_error` 或 `upstream_stream_closed`。
- 上游流超过 `OPENAI_PROXY_STREAM_IDLE_TIMEOUT_MS` 没有输出数据时，`ProxyRequestLog.errorCode` 会回写为 `upstream_stream_idle_timeout`。
- 该行为不改变对用户可见的 OpenAI 兼容响应结构、状态码、响应头或 `x-proxy-request-id`。

流式空闲超时的独立说明见 `docs/openai-proxy-stream-idle-timeout.md`。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/api run build`

线上验证建议：

1. 使用有效售出 Key 发起 `stream: true` 的 `POST /v1/responses`。
2. 在客户端收到部分响应后主动断开连接。
3. 确认 API 进程没有继续长时间占用同一条上游流。
4. 复查 `ProxyRequestLog` 中该请求仍保留本地请求 ID、租赁、Key 前缀和上游状态。
5. 确认该请求的 `durationMs` 接近实际流持续时间，且中途断开时 `errorCode=client_disconnected`。
