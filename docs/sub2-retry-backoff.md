# Sub2API 安全退避重试

## 背景

Sub2API 是本系统 OpenAI/Codex 反代和资源开通的核心依赖。网络抖动、短时 5xx 或限流会影响 Key 启停、账号查询、usage 同步和后台诊断。上一阶段已经补齐错误分类与超时；本阶段进一步加入可配置的安全重试。

## 配置项

新增 API 环境变量：

```text
SUB2_REQUEST_RETRY_ATTEMPTS=2
SUB2_REQUEST_RETRY_BASE_MS=500
```

- `SUB2_REQUEST_RETRY_ATTEMPTS`：初始请求失败后的最大重试次数；`0` 表示不重试。
- `SUB2_REQUEST_RETRY_BASE_MS`：退避基准延迟。第 1 次重试等待 `base`，第 2 次重试等待 `base * 2`。

## 重试范围

自动重试只覆盖具备幂等性的 Sub2 管理请求：

- `GET`
- `HEAD`
- `PUT`
- `DELETE`

Sub2 usage 拉取是游标式 `GET`，也启用安全重试。

创建型或副作用不明确的 `POST` 默认不自动重试，例如：

- 创建 Sub2 Key。
- 创建 Sub2 托管用户。
- 应用 OpenAI refresh token。
- 刷新上游账号。

这样可以避免请求在网络超时后被重复执行，产生重复 Key、重复账号或重复上游动作。

## 重试条件

仅当错误被分类为可重试时才会重试：

- `network`
- `timeout`
- `rate_limited`
- `upstream`

以下错误不会重试：

- `authentication`
- `parameter`
- `resource`
- `conflict`
- `invalid_response`
- `unknown`

## 可用性结论

该能力推进了 `SUB2-004`：Sub2 幂等管理操作和 usage 同步具备超时后的退避重试，能吸收短时网络、限流和上游 5xx 抖动，同时避免对非幂等 POST 进行危险重放。
