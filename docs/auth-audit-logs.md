# 认证审计日志

## 背景

后台已经具备大量管理员操作审计，但认证链路缺少登录成功、登录失败和 OAuth 绑定记录。管理员排查账号风险、异常登录、OAuth 绑定问题时，只能从应用日志或用户反馈推断。

## 覆盖范围

认证模块新增审计动作：

- `auth.register.success`
- `auth.login.success`
- `auth.login.failure`
- `auth.oauth.login.success`
- `auth.oauth.failure`
- `auth.oauth.identity.create`

## 密码登录审计

`POST /api/auth/login` 会记录：

- 登录成功。
- 用户不存在。
- 密码错误。
- 账号被禁用或封禁。
- 普通用户在 OAuth 已配置时仍尝试密码登录。

失败审计不会把用户输入的密码写入日志。

## OAuth 审计

OAuth callback 会记录：

- Provider 返回错误。
- callback 缺少 code/state。
- OAuth state 无效或过期。
- OAuth token/profile 交换失败。
- 账号被禁用或封禁。
- OAuth 登录成功。
- 新 OAuth 身份绑定。

OAuth code、code verifier、token、secret、cookie 等敏感字段会被脱敏。

## 管理员可见性

认证审计写入 `AuditLog`，后台“审计”页面已有 action 搜索/筛选能力，因此管理员可通过 `auth.login`、`auth.oauth` 等关键字过滤认证事件。

## 可用性结论

该能力补强了 `AUTH-006`：认证成功、失败和 OAuth 绑定不再只存在于瞬时请求中，而是沉淀为后台可检索的审计记录。
