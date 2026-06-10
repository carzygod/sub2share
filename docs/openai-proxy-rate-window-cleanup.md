# OpenAI/Codex 反代速率窗口清理

实现日期：2026-06-10

## 背景

本地 `/v1/*` OpenAI/Codex 反代使用租赁级 60 秒滚动窗口执行 RPM/TPM 闸门。生产环境默认使用 Redis 共享窗口；显式配置 `OPENAI_PROXY_LIMITER_STORE=memory` 时，窗口状态保存在 API 进程内。如果 memory 模式只追加窗口而不清理长期不用的租赁 ID，长时间运行后内存中的速率窗口表会逐步增长。

这类增长不会直接影响单次请求正确性，但会降低长期运行稳定性，也会让后续迁移到共享限流器时更难判断真实活跃窗口规模。

## 已实现范围

- 新增 `pruneProxyRateLimitWindow()` helper，统一按滚动窗口清理过期请求和 token 事件。
- 新增 `isProxyRateLimitWindowEmpty()` helper，用于判断窗口是否已经没有任何有效事件。
- `evaluateProxyRateLimitWindow()` 复用统一清理逻辑，保证每次 RPM/TPM 判断只基于当前有效窗口。
- 反代路由新增节流的全局窗口表清理：
  - 最多每 60 秒扫描一次 `proxyRateWindows`。
  - 每个窗口先裁掉过期事件。
  - 裁剪后为空的租赁窗口会从 Map 中删除。
- `GET /api/admin/system-health` 的 `openAiProxyRuntime` 检查会暴露当前 limiter store、活跃窗口、请求事件、token 事件和估算 token 总量；memory 模式会在生成快照前裁剪过期窗口。
- 新增自动化测试覆盖过期请求和 token 事件的裁剪，以及空窗口识别。

## 管理员价值

- memory 模式下，长时间运行的 API 进程不会因为历史租赁请求不断堆积无效速率窗口。
- Redis 模式下，速率窗口位于共享存储，适合 API 多实例部署。
- 速率限额、并发限额和反代日志继续保持实时保护能力。
- 管理员可以通过可用性巡检直接观察当前进程内速率窗口规模，辅助判断反代是否正在承压。

## 边界

该清理只处理 memory 模式下的本地进程内 RPM/TPM 状态，不会修改数据库中的租赁、订单、余额或请求日志。Redis 模式的共享窗口由 Redis key TTL 与消费脚本裁剪共同收敛。
