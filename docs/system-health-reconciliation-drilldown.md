# 系统巡检账务对账问题直达
实现日期：2026-06-12

## 背景

`GET /api/admin/reconciliation` 已经能扫描用量扣费、钱包流水、供给方结算和提现分配的一致性问题。此前 `GET /api/admin/system-health` 的 `reconciliation` 检查项只返回汇总指标，管理员在统一可用性巡检页看到 error 后，还需要进入 `账务对账` 页面重新查看明细，再复制 `refType/refId` 到对应业务页。

## 新增能力

- `GET /api/admin/system-health` 的 `reconciliation` 检查项在发现问题时返回 `detail.issues`。
- issue 继续复用账务对账明细字段：
  - `type`
  - `severity`
  - `refType`
  - `refId`
  - `amount`
  - `expected`
  - `actual`
  - `message`
- Admin `可用性巡检` 页识别账务 issue 的 `refType/refId`：
  - `refType=usage` -> 打开用量记录。
  - `refType=wallet_transaction` -> 打开余额流水并按流水 ID 搜索。
  - `refType=settlement` -> 打开供给方结算。
  - `refType=withdrawal` -> 打开提现管理。
  - `refType=order` -> 打开订单管理。
- 新增 `reconciliationHealthCheck()` 纯函数和单元测试，锁定 `reconciliation.detail.issues` 不被后续重构遗漏。

## 管理价值

- 管理员可以从统一可用性巡检页直接进入账务异常对象，缩短余额扣费、用量入账、供应商结算和提现分配问题的排查路径。
- `账务对账` 页面仍保留完整扫描视图；系统健康页负责把最高风险的问题样本暴露到可用性入口。
- 该能力只读展示证据和跳转入口，不自动改账、不修改钱包余额、订单、用量、结算或提现。

## 验证

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-reconciliation-health.test.ts tests/admin-sub2-binding-health.test.ts`
