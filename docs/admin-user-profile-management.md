# 管理员用户资料维护

实现日期：2026-06-10

## 背景

管理后台此前可以创建用户、查看用户详情、启停/封禁用户、调整角色和余额，但无法维护既有用户的基础资料或重置密码。账号售后、资料修正、手机号补录和密码找回仍需要直接改库。

本次补齐管理员用户资料维护入口，让用户管理从“查看和状态控制”扩展为“资料可维护”。

## 后端接口

- 新增接口：`PATCH /api/admin/users/:id`
- 权限要求：`admin`
- 可更新字段：
  - `displayName`
  - `phone`
  - `password`
- `displayName` 和 `phone` 支持传入 `null` 清空。
- `password` 只用于重置密码，入库前使用 bcrypt hash，不返回明文。
- 更新动作写入审计日志：`admin.user.update`。
- 审计日志只记录 `passwordReset=true/false`，不记录明文密码或 hash。

## 管理员入口

管理后台 `用户详情` 面板增强：

- 展示显示名和手机号。
- 新增基础资料表单，可保存显示名、手机号和可选新密码。
- 保存前要求管理员确认。
- 保存后刷新用户列表和当前用户详情。
- 用户 CSV 导出新增 `phone` 字段。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/admin run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/admin run build`

功能验证建议：

1. 使用管理员账号进入 `用户管理`。
2. 打开任一用户详情。
3. 修改显示名或手机号并保存。
4. 确认详情和列表刷新后展示新资料。
5. 输入新密码保存，确认审计日志出现 `admin.user.update` 且只记录 `passwordReset`。
6. 导出用户 CSV，确认包含 `phone` 字段。
