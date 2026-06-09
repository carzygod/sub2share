# 租赁 API Key 轮换能力

实现日期：2026-06-09

## 背景

OpenAI/Codex 反代服务售出的 API Key 需要具备可运营的安全闭环。用户或管理员发现 Key 泄露、误发、离职交接或售后争议时，必须能生成新 Key，并让旧 Key 失效。

此前系统已经支持租赁暂停、恢复和 API Key 启停，但缺少“换新 Key”的单次动作。本次补齐租赁级 Key 轮换能力。

## 新增接口

### 用户自助轮换

```http
POST /api/rentals/:id/rotate-key
Authorization: Bearer <user-token>
```

约束：

- 只能轮换自己的租赁。
- 租赁必须是 `active`。
- 租赁已过期时会被标记为 `expired`，本地 Key 会被停用，并返回 `rental_expired`。
- 响应中的新 API Key 只返回一次。

### 管理员代操作

```http
POST /api/admin/rentals/:id/rotate-key
Authorization: Bearer <admin-token>
```

约束：

- 仅 `admin` 角色可调用。
- 会写入审计动作 `admin.rental.rotate_key`。
- 审计记录不保存新 API Key 明文，只保存新旧 Sub2 Key ID、旧本地 Key ID 和旧 Sub2 Key 禁用结果。

## 轮换流程

1. 读取租赁、用户、产品、限额和历史 API Key。
2. 校验租赁存在、归属正确、状态为 `active` 且未过期。
3. 通过 Sub2API 为该买家创建新的自定义 Key。
4. 在本地事务中：
   - 停用该租赁下旧的本地 API Key。
   - 更新 `Rental.sub2KeyId`、`Rental.sub2KeyHash`、`Rental.endpointUrl`。
   - 创建新的本地 `ApiKey` 记录。
   - 更新 `Sub2Binding` 中的当前 `user` 和 `api_key` 绑定。
   - 为旧 Sub2 Key 写入 `rental_api_key_history` 历史绑定。
5. 本地事务成功后，尽力停用旧 Sub2 Key。
6. 若本地事务失败，尽力停用刚创建的新 Sub2 Key，避免留下孤儿 Key。

## 前端入口

- 用户端租赁页新增 `Rotate Key` 按钮。
- 管理员后台租赁列表新增 `Rotate Key` 按钮。
- 轮换成功后，新 API Key 显示在页面消息或现有一次性 Key 展示区，便于立即复制。

## 安全改进

- 用户租赁列表、租赁详情和轮换响应不再返回 `sub2KeyHash`、嵌套 `user`、`order` 或历史 `apiKeys`。
- 旧 Sub2 Key 禁用错误会先脱敏再返回或写入审计。
- 审计记录不会持久化新 API Key 明文。
- 旧 Sub2 Key 历史绑定会保留租赁 ID，避免轮换前产生但尚未同步的 usage 变成 unmatched。

## 验收方式

本地验证：

- `tsc -p apps/api/tsconfig.json --noEmit`
- `tsc -p apps/admin/tsconfig.json --noEmit`
- `tsc -p apps/web/tsconfig.json --noEmit`
- `npm --prefix apps/api run build`
- `npm --prefix apps/admin run build`
- `npm --prefix apps/web run build`

线上验收建议：

1. 创建 active Codex/OpenAI 租赁。
2. 调用用户或管理员轮换接口。
3. 确认响应返回新 API Key。
4. 使用新 Key 请求 `GET /v1/models`。
5. 使用旧 Key 请求 `GET /v1/models`，预期被本地代理拒绝。
6. 在后台审计中确认存在 `admin.rental.rotate_key`。
7. 若旧 Key 在轮换前已有未同步 usage，触发 usage 同步后应能归属到原租赁。

## 当前限制

轮换能力修复的是 Key 泄露和售后安全问题，不会直接修复 Sub2API/OpenAI 上游账号失效问题。`POST /v1/responses` 的真实生成仍依赖 active 且凭据有效的 OpenAI 上游账号。
