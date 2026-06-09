# 系统安全维护动作

实现日期：2026-06-10

## 背景

系统已经具备可用性巡检、过期租赁收敛、到期结算释放和 Sub2 本地绑定修复能力。为了让管理员在巡检发现常见可修复问题后不必跳转多个页面逐个处理，本次新增统一的安全维护入口。

## 后端接口

- 新增接口：`POST /api/admin/system-maintenance/run`
- 权限要求：`admin`
- 默认执行：
  - `expireOverdueRentals`：收敛到期租赁，停用本地 API Key，并尽力停用对应 Sub2 Key。
  - `deactivateInvalidProxyApiKeys`：停用确定无法通过本地 OpenAI/Codex `/v1/*` 反代准入的 active Key。
  - `releaseAvailableSettlements`：释放已经到期的 pending 结算。
  - `repairSub2Bindings`：补齐或修正本地 `Sub2Binding` 映射。
- 执行完成后会重新生成一次 `system-health` 巡检结果。
- 操作写入审计日志 `admin.system.maintenance_run`。

## 安全边界

- 不直接改用户余额。
- 不创建新订单。
- 不创建、轮换或发放新的 API Key。
- 只自动停用缺失租赁、租赁非 active、租赁已过期或 Key hash 与租赁不一致的本地 active Key。
- 不因用户钱包余额不足、缺少 Sub2 Key ID 或缺少 Sub2 Key hash 自动停用 Key，这些场景仍保留给管理员判断。
- 异常 Key 收敛只更新本地 `ApiKey.status=inactive`，不调用 Sub2API，避免在 Key hash 不一致等场景误操作上游当前 Key。
- 不自动同步 Sub2 usage，避免在维护动作中触发外部账务入账。
- Sub2 绑定修复只修本地映射，不调用 Sub2API。
- 到期结算释放只处理 `status = pending` 且 `availableAt <= now` 的记录。

## 管理员入口

管理后台 `可用性巡检` 页面新增 `运行安全维护` 按钮。

执行后页面展示最近维护结果：

- 过期租赁数量。
- 停用异常反代 Key 数量。
- 释放结算数量。
- 修复绑定数量。
- 完成时间。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
