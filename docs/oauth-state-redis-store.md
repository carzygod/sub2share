# OAuth State Redis 存储

实现日期：2026-06-10

## 背景

OAuth 登录依赖 `state` 和 PKCE `code_verifier` 关联登录发起请求与回调请求。此前这些状态保存在 API 进程内 `Map` 中，服务重启或多实例部署时，回调可能落到另一个进程，导致用户或管理员登录失败并返回 `invalid_oauth_state`。

这会直接影响用户入口、管理员入口和系统可用性，尤其是生产环境滚动发布、故障重启或横向扩容时。

## 已实现范围

- 新增 `OAUTH_STATE_STORE` 环境变量，取值：
  - `redis`：使用 Redis 保存 OAuth state。
  - `memory`：使用进程内内存保存 OAuth state，仅适合开发或测试。
- 未显式配置时：
  - `NODE_ENV=production` 默认使用 `redis`。
  - 非生产环境默认使用 `memory`。
- OAuth start 阶段会把 provider、PKCE verifier 和过期时间写入状态存储。
- OAuth callback 阶段会一次性消费 state，消费后立即删除，防止重复回调重放。
- Redis state 使用 10 分钟 TTL，key 过期后自动失效。
- API 进程关闭时会释放 Redis 客户端连接。
- `GET /api/admin/system-health` 新增 `oauthStateStore` 检查项：
  - 生产环境使用内存 state 标记 error。
  - Redis 不可达时标记 error。
  - 非生产环境内存 state 标记 warning，但不阻断本地开发。
- `.env.example` 新增 `OAUTH_STATE_STORE=redis`。

## 管理员价值

- 管理员可以在 `可用性巡检` 中直接看到 OAuth state 是否具备生产级共享存储。
- 滚动发布、API 重启或多实例扩容时，OAuth 回调不再依赖发起登录的同一进程。
- 用户登录、管理员登录和 OAuth 身份绑定的稳定性更接近生产要求。

## 边界

该能力只解决 OAuth state 与 PKCE verifier 的短期会话关联，不等同于完整 refresh token 生命周期管理。后续仍需要继续补齐访问令牌刷新、refresh token 存储策略和更细的 OAuth 凭据安全管理。
