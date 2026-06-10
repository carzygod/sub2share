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
- RPM/TPM 会在租赁级并发租约成功后原子消费；若速率失败，会立即释放并发租约。
- 新增 `OPENAI_PROXY_LIMITER_STORE`，生产环境默认 `redis`，非生产环境默认 `memory`。
- Redis 模式使用共享 60 秒滚动窗口，适合 API 多实例部署。
- memory 模式会按 60 秒滚动窗口裁剪；长期无有效事件的租赁窗口会被节流清理，避免运行期 Map 无限制增长。

## 记账顺序

反代入口会先执行本地请求量检查，再申请并发租约，随后原子消费 RPM/TPM。若并发租约失败，请求会返回 `429 concurrency_limit_exceeded` 并写入反代请求日志，但不会占用 RPM/TPM。

若 RPM/TPM 失败，系统会释放刚取得的并发租约，并返回 `429 rpm_limit_exceeded` 或 `429 tpm_limit_exceeded`。这样可以避免“没有进入上游的失败请求”污染用户套餐并发或速率额度。

详细说明见 `docs/openai-proxy-rate-accounting-order.md`。

## TPM 估算

当前没有引入精确 tokenizer。TPM 前置闸门按请求体 UTF-8 文本长度粗略估算：

```text
estimatedTokens = ceil(requestBody.length / 4)
```

该估算用于本地实时保护，不替代 Sub2 usage 同步后的最终计费和结算。

## 边界

生产环境默认 Redis 共享计数，适合 API 多实例部署。显式配置 `OPENAI_PROXY_LIMITER_STORE=memory` 时，RPM/TPM 闸门仍是单 API 进程内计数，只适合本地开发、测试或明确的单实例部署。

运行期窗口清理说明见 `docs/openai-proxy-rate-window-cleanup.md`。
Redis 共享限流说明见 `docs/openai-proxy-redis-limiter.md`。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 API build | 通过 |
