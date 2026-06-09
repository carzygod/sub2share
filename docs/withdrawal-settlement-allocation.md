# 提现结算分配与核销

实现日期：2026-06-09

## 背景

提现金额护栏可以防止超额提现，但如果提现没有绑定具体结算记录，管理员仍难以回答“这笔提现消耗了哪些供给收益”。为了让提现、结算、打款形成可追踪闭环，需要记录提现与结算的分配关系，并维护每条结算的已占用和已提现金额。

## 已实现范围

- `SettlementRecord` 新增：
  - `reservedAmount`
  - `withdrawnAmount`
- 新增 `WithdrawalSettlement` 分配表，记录：
  - `withdrawalId`
  - `settlementRecordId`
  - `amount`
  - `status`
- 新增迁移 `user/prisma/migrations/0008_withdrawal_settlement_allocations/migration.sql`。
- 创建 `pending` / `approved` 提现时，从供给方 `available` 结算中分配金额，分配状态为 `reserved`。
- 创建 `paid` 提现时，直接分配并记为 `paid`，对应结算增加 `withdrawnAmount`。
- `approved -> paid` 时，将该提现的 `reserved` 分配转为 `paid`，并把结算金额从 `reservedAmount` 转入 `withdrawnAmount`。
- `pending/approved -> rejected/cancelled` 时，释放该提现的 `reserved` 分配。
- 结算状态会随金额变化自动收敛：
  - 全额提现后为 `withdrawn`
  - 全额占用但未打款时为 `frozen`
  - 仍有可用余额时为 `available`
- 管理后台提现列表展示已分配金额和结算条数。
- 管理后台结算列表展示占用金额和已提现金额。

## 边界

- 分配以结算剩余额度为单位，支持一笔提现分配到多条结算，也支持一条结算被部分分配。
- 历史已存在但没有分配记录的 `pending` / `approved` / `paid` 提现仍会在可提现金额计算中作为保守占用；当管理员继续推进这些提现状态时，系统会补充分配。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 Prisma generate | 通过 |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
