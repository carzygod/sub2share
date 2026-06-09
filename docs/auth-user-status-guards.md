# 用户状态鉴权保护

## 背景

后台已经支持将用户状态调整为 `active`、`disabled` 或 `banned`。此前登录流程会拒绝非 active 用户，但已经签发的 JWT 在后续业务接口中只做验签，不会回查数据库状态。被禁用或封禁的用户如果仍持有旧 token，可能继续访问钱包、订单、租赁、供给方和后台接口。

## 实现范围

公共鉴权函数 `requireAuth` 现在会在验签后回查数据库：

```text
user/apps/api/src/common/auth.ts
```

校验内容：

1. JWT 必须有效。
2. token 中的用户必须仍存在。
3. 用户状态必须为 `active`。
4. 用户角色从数据库实时读取，而不是完全信任 token 中的旧角色。

`requireRole` 继续基于 `requireAuth`，因此角色调整、禁用和封禁会立即影响后台、钱包、订单、租赁、供给方和计费等接口。

## 管理员保护

后台用户状态接口增加保护：

```text
PATCH /api/admin/users/:id/status
```

- 管理员不能禁用或封禁自己的 admin 账号。
- 系统不能禁用或封禁最后一个 active admin。
- 状态变更继续写入 `AuditLog`。

## 可用性结论

该能力补齐了 `AUTH-005`：用户被禁用或封禁后，即使持有未过期 JWT，也不能继续访问核心业务接口。后台角色变更也会即时生效，降低旧 token 绕过权限调整的风险。
