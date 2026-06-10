# OpenAI/Codex 流式响应空闲超时

实现日期：2026-06-10

## 背景

`POST /v1/responses` 等 OpenAI/Codex 请求可能使用流式响应。此前本地反代的 `OPENAI_PROXY_UPSTREAM_TIMEOUT_MS` 主要覆盖请求转发到拿到上游响应头之前的阶段；一旦 Sub2API 已返回响应头但响应体长时间没有继续输出数据，本地连接、租赁并发租约和上游生成资源都可能被长期占用。

## 实现范围

- 新增环境变量 `OPENAI_PROXY_STREAM_IDLE_TIMEOUT_MS`，默认 `300000` 毫秒。
- 上游响应体开始透传后，本地反代会监控流式数据输出。
- 每次收到上游数据 chunk 时刷新空闲计时器。
- 如果超过空闲超时时间仍没有任何数据输出：
  - 中止上游 `AbortController`。
  - 销毁本地透传流。
  - 回写 `ProxyRequestLog.errorCode=upstream_stream_idle_timeout`。
  - 更新 `ProxyRequestLog.durationMs` 为完整占用时长。
- 系统可用性巡检会把 `upstream_stream_idle_timeout` 计入反代请求的上游流异常。

## 管理员价值

- 长时间无输出的流式生成不会无限占用本地并发额度。
- 管理员可以在 `反代请求` 日志中按 `upstream_stream_idle_timeout` 定位卡住的流式请求。
- 可用性巡检会把该类问题提升为反代上游流异常，便于判断 Sub2API 或上游模型输出链路是否不稳定。

## 设计边界

- 该能力只在已经拿到上游响应体后生效。
- 拿到响应头之前的超时仍由 `OPENAI_PROXY_UPSTREAM_TIMEOUT_MS` 控制。
- 超时发生时响应通常已经开始发送，无法再返回新的 OpenAI JSON 错误体；客户端会看到流被中止，并可用 `x-proxy-request-id` 找到对应日志。
