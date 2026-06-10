# 访问令牌刷新

实现日期：2026-06-10

## 背景

用户端和管理员端都依赖 JWT 访问业务 API。此前登录、注册和 OAuth 回调只返回一个访问 token，缺少 refresh token。访问 token 一旦过期，用户或管理员只能重新登录；如果后续为访问 token 增加较短有效期，长时间管理操作也会更容易被中断。

## 已实现范围

- 后端新增环境配置：
  - `JWT_REFRESH_SECRET`：refresh token 签名密钥，未配置时回退到 `JWT_ACCESS_SECRET`。
  - `JWT_ACCESS_EXPIRES_IN`：访问 token 有效期，默认 `15m`。
  - `JWT_REFRESH_EXPIRES_IN`：refresh token 有效期，默认 `30d`。
- `GET /api/admin/system-health` 新增 `authTokens` 检查项，生产环境缺少独立 `JWT_REFRESH_SECRET` 时标记 error。
- 登录、注册和 OAuth 回调继续返回兼容字段 `token`，并新增：
  - `refreshToken`
  - `expiresIn`
  - `refreshExpiresIn`
- 新增 `POST /api/auth/refresh`：
  - 请求体：`{ "refreshToken": "..." }`
  - 验证 refresh token 类型、签名和有效期。
  - 回查用户状态与角色。
  - 用户不存在或 refresh token 无效时返回 `401 invalid_refresh_token`。
  - 用户被禁用或封禁时返回 `403 account_disabled`。
  - 成功后返回新的访问 token、refresh token 和当前用户信息。
- access token payload 标记为 `type=access`，refresh token payload 标记为 `type=refresh`。
- 核心鉴权 `requireAuth()` 会拒绝 `type=refresh` 的 token，防止 refresh token 被当成访问 token 使用。
- Web 用户端和 Admin 管理端 API helper 在遇到 401 时会尝试用本地 refresh token 刷新访问 token，并重试原请求一次。
- OAuth 回调 hash 新增 `auth_refresh_token`，用户端会保存该 refresh token。
- 新增自动化测试覆盖 refresh token payload 不可访问受保护接口。

## 管理员价值

- 管理员进行较长时间的用户、余额、售出、共享资源和反代排障操作时，不再因为短访问 token 过期而立刻中断。
- 用户端购买、查看租赁、余额和供给方资源时，也可以自动续签访问 token。
- 用户被禁用、封禁或角色变更后，刷新接口会回查数据库，新的访问 token 会反映最新状态和角色。

## 边界

当前 refresh token 是签名式 JWT，不保存服务端会话记录，因此无法单独撤销某一枚 refresh token。禁用用户或封禁用户可以阻止继续刷新；后续若需要设备级退出、单 token 撤销或 refresh token 轮换复用检测，需要增加持久化 token 会话表。
