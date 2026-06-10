# OpenAI/Codex 反代速率记账顺序

实现日期：2026-06-10

## 背景

本地 `/v1/*` OpenAI/Codex 反代会同时执行请求量、RPM/TPM、并发、余额、租赁状态和 Sub2API 上游转发等多层门禁。此前 RPM/TPM 检查会在申请并发租约之前直接写入进程内滚动窗口。如果租赁并发已经打满，用户请求最终会被 `429 concurrency_limit_exceeded` 拒绝，但该请求仍会占用 RPM/TPM 窗口。

这会带来两个问题：

- 被本地并发闸门拒绝、没有进入上游的请求会挤占用户速率额度。
- 管理员排查套餐可用性时，RPM/TPM 使用量会混入未实际转发的失败请求。

## 已实现范围

- 将速率窗口逻辑拆成“检查”和“提交”两个阶段。
- `checkRentalRateLimits()` 只判断当前请求是否会超过 RPM/TPM，并返回本次请求预计占用量。
- 只有 `acquireProxyConcurrency()` 成功取得并发租约后，才调用 `rateLimitCheck.record()` 写入 RPM/TPM 窗口。
- 并发失败时仍写入 `ProxyRequestLog(errorCode=concurrency_limit_exceeded)`，但不消耗 RPM/TPM。
- 新增 `evaluateProxyRateLimitWindow()` helper，用于可测试地评估窗口、清理过期事件和延迟提交。
- 新增自动化测试覆盖：速率检查不会立即修改窗口，调用 `commit()` 后才计入 RPM/TPM。

## 执行顺序

当前 `/v1/*` 本地代理的关键准入顺序为：

1. 校验本地 API Key、用户、租赁、余额、资源类型和剩余额度。
2. 校验本地请求量台账。
3. 评估 RPM/TPM 是否允许本次请求，但暂不提交窗口。
4. 申请租赁级并发租约。
5. 并发租约成功后提交 RPM/TPM 速率窗口。
6. 转发到 Sub2API，并写入成功或失败的反代请求日志。

## 管理员价值

- 并发打满不会进一步吞掉用户 RPM/TPM，套餐权益更符合实际转发结果。
- `反代请求` 页面中 `concurrency_limit_exceeded` 与 `rpm_limit_exceeded`、`tpm_limit_exceeded` 的边界更清楚。
- 售后排查时可以更准确地区分“用户并发过高”和“用户速率额度耗尽”。

## 边界

当前 RPM/TPM 和并发租约仍是单 API 进程内状态，适合现有单实例部署。若后续 API 多实例扩容，仍需要迁移到 Redis、Sub2API 网关或其他共享限流器中，保证跨实例的一致性。
