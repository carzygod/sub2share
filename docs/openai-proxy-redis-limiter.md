# OpenAI/Codex 反代 Redis 共享限流器

实现日期：2026-06-10

## 背景

本地 `/v1/*` OpenAI/Codex 反代已经在请求进入 Sub2API 前执行租赁级并发、RPM 和 TPM 闸门。此前这些状态保存在单个 API 进程内，适合单实例部署；一旦 API 横向扩容，不同实例会各自计数，可能导致同一租赁在多实例下突破套餐并发或速率权益。

## 已实现范围

- 新增环境变量 `OPENAI_PROXY_LIMITER_STORE`：
  - `redis`：使用 Redis 存储并发租约与 RPM/TPM 窗口。
  - `memory`：使用进程内存，适合本地开发和测试。
- 未显式配置时，生产环境默认 `redis`，非生产环境默认 `memory`。
- 新增 `limiter-store.ts`，统一封装 OpenAI 反代限流状态：
  - `acquireOpenAiProxyConcurrency()`：租赁级并发租约。
  - `consumeOpenAiProxyRateLimit()`：租赁级 RPM/TPM 原子消费。
  - `inspectOpenAiProxyRuntimeState()`：管理员巡检运行态快照。
  - `inspectOpenAiProxyLimiterReadiness()`：部署 readiness 依赖检查。
- Redis 并发租约使用原子 Lua 脚本递增和释放，并带 TTL 与周期续租；API 进程异常退出时，租约会在 TTL 后自动收敛。
- Redis RPM/TPM 使用原子 Lua 脚本裁剪 60 秒窗口、判断限额并写入事件，避免多实例下“先检查后提交”的竞态。
- `/v1/*` 反代准入顺序调整为：
  1. 请求量台账检查。
  2. 获取并发租约。
  3. 原子消费 RPM/TPM。
  4. RPM/TPM 失败时立即释放并发租约。
  5. 成功后转发到 Sub2API。
- Redis 不可达时，本地反代返回 OpenAI 风格 `503 proxy_limiter_unavailable`，并写入 `ProxyRequestLog`。
- `GET /ready` 新增 `openAiProxyLimiter` 依赖；Redis 模式不可达时返回 HTTP 503。
- `GET /api/admin/system-health` 的 `openAiProxyRuntime` 会展示当前 limiter store、作用域、Redis 可达性、活跃并发和速率窗口指标。
- `.env.example` 新增 `OPENAI_PROXY_LIMITER_STORE=redis`。
- 新增自动化测试覆盖 limiter store 默认模式。

## 管理员价值

- 生产多实例部署可以通过 Redis 共享并发和 RPM/TPM 状态，不再依赖单 API 进程内计数。
- 管理员可以在 `可用性巡检` 中直接确认当前反代限流器是否为 Redis 共享作用域。
- 部署平台可以通过 `/ready` 在 Redis 不可达时摘除实例，避免售出的 OpenAI/Codex 入口进入不可控状态。

## 边界

- Redis 共享限流器只负责本地反代准入保护，不替代 Sub2API 上游调度、真实 usage 同步、钱包扣费或供应商结算。
- TPM 仍使用请求体长度粗略估算，用于前置保护；最终账务仍以 Sub2 usage 同步结果为准。
- 如果显式配置 `OPENAI_PROXY_LIMITER_STORE=memory`，生产环境仍可启动，但管理员巡检会标记 warning，提示保持单实例或切换 Redis。
