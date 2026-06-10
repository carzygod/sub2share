# 认证 Token 配置巡检

实现日期：2026-06-10

## 背景

系统已经支持 access token 与 refresh token。为了让访问 token 可以短有效期、refresh token 可以长有效期，生产环境应使用独立的 `JWT_REFRESH_SECRET`。如果 refresh token 回退复用 `JWT_ACCESS_SECRET`，功能仍可运行，但两个 token 类型的密钥边界会变弱。

## 已实现范围

- 新增 `inspectAuthTokenConfig()` helper，集中检查认证 token 配置。
- `GET /api/admin/system-health` 新增 `authTokens` / `Auth Tokens` 检查项。
- 巡检指标暴露：
  - `accessExpiresIn`
  - `refreshExpiresIn`
  - `refreshSecretConfigured`
  - `refreshSecretDistinct`
- 生产环境缺少 `JWT_REFRESH_SECRET` 时标记 error。
- 生产环境 `JWT_REFRESH_SECRET` 与 `JWT_ACCESS_SECRET` 相同时标记 error。
- access token 与 refresh token 有效期完全相同时标记 warning。
- 新增自动化测试覆盖生产缺少独立 refresh secret 和独立配置通过两类场景。

## 管理员价值

- 管理员可以在 `可用性巡检` 中直接看到认证续签配置是否达到生产要求。
- 访问 token 短有效期、refresh token 长有效期的配置边界更清晰。
- 可以在上线前发现 refresh token 密钥复用问题，减少认证体系后续扩展时的安全债。

## 边界

该巡检只检查环境配置和有效期字符串，不会解码真实用户 token，也不会撤销既有 token。若已经在生产环境误用同一密钥，应配置新的 `JWT_REFRESH_SECRET` 并让用户重新登录。
