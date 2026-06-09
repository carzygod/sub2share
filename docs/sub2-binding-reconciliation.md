# Sub2 绑定巡检与修复

实现日期：2026-06-10

## 背景

本地租赁会保存 `sub2UserId`、`sub2KeyId`，并通过 `Sub2Binding` 建立本地对象与 Sub2API 对象的映射。该映射会影响 Sub2 usage 同步时的租赁反查，也会影响管理员排查反代请求和历史 Key 轮换问题。为了降低映射缺失导致的用量归因风险，本次新增后台巡检和修复入口。

## 后端接口

### `GET /api/admin/sub2/bindings/reconciliation`

权限：`operator` 或 `admin`

能力：

- 扫描最近一批带 `sub2UserId` 或 `sub2KeyId` 的租赁。
- 检查 `sub2KeyId` 是否存在当前 `api_key` 绑定。
- 检查当前 `api_key` 绑定是否与租赁字段一致。
- 检查 `sub2UserId` 是否至少存在一个 `user` 绑定。
- 检查 `Sub2Binding` 是否指向不存在的租赁。

### `POST /api/admin/sub2/bindings/repair`

权限：`admin`

能力：

- 对带 `sub2UserId` 或 `sub2KeyId` 的租赁补齐本地 `Sub2Binding`。
- 对当前 `api_key` 绑定执行严格修复，使其指向当前租赁。
- 对 `user` 绑定采用保守策略：如果同一个 `sub2UserId` 已经存在绑定，不强行改绑到当前租赁，避免破坏同一买家多租赁复用 Sub2 user 的场景。
- 修复动作写入审计日志 `admin.sub2.bindings.repair`。

## 管理员入口

管理后台 `反代状态` 页面新增 `Sub2 绑定巡检` 面板。

展示内容：

- 扫描租赁数。
- 扫描绑定数。
- 发现问题数。
- 最近巡检时间。
- 最多展示前 8 条问题明细。

操作：

- `巡检绑定`：重新读取绑定一致性。
- `修复绑定`：补齐或更新本地绑定。

## 设计边界

- 本功能只修复本地 `Sub2Binding` 映射。
- 不调用 Sub2API。
- 不创建、启用、停用或轮换上游 Key。
- 不修改钱包、订单、租赁状态或结算数据。
- orphan binding 仅提示，不自动删除，避免误删历史追踪信息。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
