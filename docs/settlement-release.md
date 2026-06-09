# 到期结算释放

实现日期：2026-06-09

## 背景

Sub2 usage 同步会创建供应商结算记录，并把 `availableAt` 设置为 3 天后。此前结算记录创建后会停留在 `pending`，缺少把到期结算收敛为 `available` 的维护入口，影响供给方收益展示、提现准备和管理员结算管理。

## 已实现范围

- 新增任务 `releaseAvailableSettlements`。
- 新增后台接口 `POST /api/admin/settlements/release-available`。
- 仅 `admin` 角色可触发。
- 默认每次最多处理 200 条，接口可传 `limit`，最大 1000。
- 仅释放满足以下条件的结算：
  - `status = pending`
  - `availableAt <= now`
- 释放后将结算状态更新为 `available`。
- 不修改 `frozen`、`withdrawn`、`cancelled` 等非 pending 状态。
- 管理后台“结算管理”页面新增 `Release available` 按钮。
- 操作写入审计日志 `admin.settlement.release_available`。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
