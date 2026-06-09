# Sub2API 错误分类与超时保护

## 背景

Sub2API 是 OpenAI/Codex 反代、Key 开通、Key 启停、usage 同步和资源健康测试的网关内核。此前 Sub2 管理 API 请求失败时通常只抛出普通 `Error`，错误信息混合 HTTP 状态和响应体；网络失败、超时、鉴权失败、参数错误、资源不足、限流和上游 5xx 不容易区分。

## 配置项

新增 API 环境变量：

```text
SUB2_REQUEST_TIMEOUT_MS=30000
```

该配置控制 Sub2 管理 API、usage 同步、资源账号测试和健康探测的默认请求超时时间。

## 错误模型

新增错误类型：

```text
Sub2ApiError
```

错误包含：

- `kind`：错误分类。
- `statusCode`：HTTP 状态码，网络错误或超时时为空。
- `retryable`：是否适合重试。
- `body`：脱敏后的响应摘要。

当前分类：

- `authentication`：401 / 403。
- `parameter`：400 / 404 / 422。
- `resource`：402 或响应体包含 quota、balance、insufficient 等资源不足语义。
- `rate_limited`：429 或响应体包含 rate limit / too many。
- `conflict`：409。
- `timeout`：请求超时。
- `network`：网络连接失败。
- `upstream`：5xx。
- `invalid_response`：响应不是有效 JSON。
- `unknown`：其他未分类状态。

## 覆盖范围

以下 Sub2 调用已接入统一超时和错误分类：

- 管理 API 通用请求。
- usage 同步拉取。
- 资源账号测试。
- `/health` 网关健康探测。

OpenAI/Codex `/v1/*` 反代自身仍使用独立的 `OPENAI_PROXY_UPSTREAM_TIMEOUT_MS`，用于长时间流式生成场景。

## 可用性结论

该能力补齐了 `SUB2-003`，并为 `SUB2-004` 的重试、退避和熔断打下基础。管理员后台和审计日志里的 Sub2 失败信息会更容易判断是鉴权、参数、资源、限流、网络、超时还是上游故障。
