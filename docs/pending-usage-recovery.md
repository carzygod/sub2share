# Pending Usage 账务恢复

实现日期：2026-06-10

## 背景

Sub2 usage 同步在买家余额不足时会创建 `UsageRecord(status=pending)`，并把租赁标记为 `low_balance`。此前后续同步遇到相同 `sub2RequestId` 会直接跳过，用户充值后这条 pending usage 仍可能长期无法扣费、无法生成供应商结算，影响余额、售出收入和共享收益的准确性。

## 实现范围

- Sub2 usage 同步现在会先检查本地是否已存在同一 `sub2RequestId`。
- 若已存在记录为 `pending` 且 `buyerCharge > 0`，同步任务会重新尝试扣买家钱包。
- 扣费成功后会把 usage 更新为 `billed`，并补齐 `WalletTransaction(type=consume, refType=usage)`。
- 若 usage 存在 `supplierResourceId` 且 `supplierIncome > 0`，会补齐对应 `SettlementRecord`。
- 若余额仍不足，usage 保持 `pending`，租赁继续保持或进入 `low_balance`。
- 恢复扣费成功后，如果该租赁没有其他 pending usage 且额度未耗尽，会从 `low_balance` 自动恢复为 `active`。
- 如果额度或请求次数已经耗尽，恢复后租赁进入 `limited`。
- 管理员手动同步 usage 的返回值新增 `recovered`，用于标识本次恢复入账的 pending usage 数量。
- `BillingSyncRun.recovered` 和 `BillingSyncState.lastRecovered` 会持久化恢复数量，管理员刷新页面或查看历史批次时仍能区分新导入和 pending 恢复。

## 幂等约束

新增迁移：

```text
user/prisma/migrations/0012_usage_billing_idempotency/migration.sql
```

新增数据库唯一索引：

- 每条 usage 最多一条 `consume` 钱包流水。
- 每条 usage 最多一条供应商结算记录。

这两个约束让定时同步、管理员手动同步和并发重试不会重复扣费或重复分润。若生产库历史上已经存在重复 usage 扣费流水或重复 usage 结算，执行迁移前需要先通过对账入口定位并清理重复数据。

## 可用性结论

该能力补齐了按量商品零预付开通后的账务闭环：用户余额不足导致的 pending usage 不再只能人工处理，充值后下一次 Sub2 usage 同步即可尝试恢复扣费、恢复结算，并让管理员在同步结果中看到恢复数量。

## 巡检配套

系统可用性巡检已新增 `pendingUsageBilling` 检查项，用于统计仍处于 pending 的 usage 数量、金额、最早发生时间和问题样本。详见 `docs/pending-usage-health-check.md`。
