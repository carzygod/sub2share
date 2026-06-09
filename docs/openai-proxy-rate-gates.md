# OpenAI 反代 RPM/TPM 闸门

实现日期：2026-06-09

## 背景

租赁限额已经包含 `rpmLimit` 和 `tpmLimit`，管理员也可以调整这些字段。为了让售出的套餐权益在本系统 `/v1/*` 反代入口即时生效，需要在转发到 Sub2API 之前增加本地速率闸门。

## 已实现范围

- `/v1/*` 反代入口新增租赁级 60 秒滚动窗口。
- `RentalLimit.rpmLimit` 用于限制每分钟请求数。
- `RentalLimit.tpmLimit` 用于限制每分钟估算输入 token 数。
- 超过 RPM 时返回 OpenAI 风格 `429 rpm_limit_exceeded`。
- 超过 TPM 时返回 OpenAI 风格 `429 tpm_limit_exceeded`。
- `GET /v1/models`、`HEAD /v1/models` 和模型详情元数据请求不计入 RPM/TPM，便于用户排查可用模型。
- 代理日志新增 `proxyRpmLimit`、`proxyRpmUsed`、`proxyTpmLimit`、`proxyTpmUsed` 和 `proxyEstimatedInputTokens`。

## TPM 估算

当前没有引入精确 tokenizer。TPM 前置闸门按请求体 UTF-8 文本长度粗略估算：

```text
estimatedTokens = ceil(requestBody.length / 4)
```

该估算用于本地实时保护，不替代 Sub2 usage 同步后的最终计费和结算。

## 边界

当前 RPM/TPM 闸门是单 API 进程内计数，适合当前单实例部署。若后续 API 多实例扩容，需要迁移到 Redis、Sub2API 网关或其他共享限流器中。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 API build | 通过 |
