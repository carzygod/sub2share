# OpenAI/Codex 反代速率记账顺序

实现日期：2026-06-10

## 背景

本地 `/v1/*` OpenAI/Codex 反代会同时执行请求量、RPM/TPM、并发、余额、租赁状态和 Sub2API 上游转发等多层门禁。此前 RPM/TPM 检查会在申请并发租约之前直接写入进程内滚动窗口。如果租赁并发已经打满，用户请求最终会被 `429 concurrency_limit_exceeded` 拒绝，但该请求仍会占用 RPM/TPM 窗口。

这会带来两个问题：

- 被本地并发闸门拒绝、没有进入上游的请求会挤占用户速率额度。
- 管理员排查套餐可用性时，RPM/TPM 使用量会混入未实际转发的失败请求。

## 已实现范围

- 将限流状态抽到 `limiter-store.ts`，支持 memory 与 Redis 两种存储。
- 当前请求会先取得租赁级并发租约，再通过 `consumeOpenAiProxyRateLimit()` 原子消费 RPM/TPM。
- RPM/TPM 失败时会立即释放刚取得的并发租约。
- 并发失败时仍写入 `ProxyRequestLog(errorCode=concurrency_limit_exceeded)`，但不消耗 RPM/TPM。
- memory 模式继续复用 `evaluateProxyRateLimitWindow()` helper。
- Redis 模式通过 Lua 脚本在共享存储中裁剪窗口、判断限额并写入事件，避免多实例竞态。

## 执行顺序

当前 `/v1/*` 本地代理的关键准入顺序为：

1. 校验本地 API Key、用户、租赁、余额、资源类型和剩余额度。
2. 校验本地请求量台账。
3. 申请租赁级并发租约。
4. 原子消费 RPM/TPM 速率窗口。
5. 若 RPM/TPM 失败，立即释放并发租约并返回 OpenAI 风格 `429`。
6. 转发到 Sub2API，并写入成功或失败的反代请求日志。

## 管理员价值

- 并发打满不会进一步吞掉用户 RPM/TPM，套餐权益更符合实际转发结果。
- `反代请求` 页面中 `concurrency_limit_exceeded` 与 `rpm_limit_exceeded`、`tpm_limit_exceeded` 的边界更清楚。
- 售后排查时可以更准确地区分“用户并发过高”和“用户速率额度耗尽”。

## 边界

生产环境默认使用 Redis 共享限流器，适合 API 多实例部署。若显式配置 `OPENAI_PROXY_LIMITER_STORE=memory`，RPM/TPM 和并发租约仍只在单 API 进程内生效，适合本地开发、测试或明确的单实例部署。
