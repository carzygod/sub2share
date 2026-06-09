# 账务对账入口

实现日期：2026-06-09

## 背景

当前系统已经具备用量同步、买家钱包扣费、供应商结算、提现分配与核销能力。为了让管理员可以系统性复查账务可用性，本次新增一个只读对账入口，把跨表一致性问题集中暴露出来，避免管理员只能分别进入用量、流水、结算和提现列表手工排查。

## 后端接口

- 新增接口：`GET /api/admin/reconciliation`
- 权限要求：`operator` 或 `admin`
- 返回内容：
  - `checkedAt`：本次巡检时间。
  - `ok`：当前扫描范围内是否无问题。
  - `scanLimit`：每类候选数据扫描上限，当前为 500。
  - `summary`：五类问题计数与总数。
  - `scanned`：本次实际扫描的数据量。
  - `issues`：最多返回 50 条问题明细。

## 巡检规则

1. `billed_usage_missing_wallet_transaction`
   - 已入账用量 `status = billed` 且 `buyerCharge > 0`。
   - 若缺少 `WalletTransaction(type=consume, refType=usage, refId=usage.id)`，标记为异常。

2. `wallet_transaction_missing_usage`
   - 钱包扣费流水 `type = consume` 且 `refType = usage`。
   - 若 `refId` 指向的 `UsageRecord` 不存在，标记为异常。

3. `usage_settlement_mismatch`
   - 已入账用量 `status = billed` 且 `supplierIncome > 0`。
   - 若该用量关联结算金额合计不等于 `supplierIncome`，标记为异常。

4. `settlement_overallocated`
   - 结算记录的 `reservedAmount + withdrawnAmount` 不得大于 `amount`。
   - 超出时说明结算被过度占用或核销。

5. `withdrawal_allocation_mismatch`
   - `pending` / `approved` / `paid` 提现应有对应的有效分配。
   - `reserved` 与 `paid` 分配金额合计应等于提现金额。

## 管理员入口

- 管理后台新增侧边栏入口：`账务对账`。
- 页面上方展示：
  - 当前对账状态。
  - 扫描上限和检查时间。
  - 五类问题计数。
- 页面下方展示问题明细：
  - 级别。
  - 问题类型。
  - 引用对象。
  - 金额。
  - 期望/实际金额。
  - 说明。
  - 时间。

## 设计边界

- 本功能只读，不自动改账。
- 对账问题应通过既有的用量同步、结算释放、提现审核、审计记录等入口继续处理。
- 本轮实现采用有界扫描，避免管理员打开页面时对生产库造成长时间重负载。
- 若后续数据量增长，应扩展为异步对账任务，保存对账批次、全量计数和修复建议。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
