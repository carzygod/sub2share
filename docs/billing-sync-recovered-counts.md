# Sub2 用量同步恢复计数持久化

实现日期：2026-06-12

## 背景

Sub2 usage 同步支持把历史 `pending` 用量在用户余额恢复后重新扣费，并补齐供应商结算。此前 `syncSub2UsageOnce()` 会在当次响应中返回 `recovered`，但 `BillingSyncRun` 和 `BillingSyncState` 只保存 `imported/skipped/unmatched`。管理员刷新页面或查看历史批次时，无法区分“新导入 usage”和“已存在 pending usage 恢复入账”。

## 已实现能力

- 新增 Prisma migration：`0016_billing_sync_recovered_counts`。
- `BillingSyncRun` 新增 `recovered` 字段。
- `BillingSyncState` 新增 `lastRecovered` 字段。
- `syncSub2UsageOnce(cursor, { persistCursor: true })` 成功后会持久化：
  - 本批次 `recovered`。
  - 最近一次 `lastRecovered`。
- `GET /api/admin/usages/sync-state` 返回同步状态和最近批次时会包含恢复计数。
- `GET /api/admin/system-health` 的 `billingSync.metrics` 新增 `lastRecovered`。
- Admin `用量记录` 页面同步状态面板改为展示：
  - 最近结果：导入 / 恢复 / 跳过 / 未匹配。
  - 最近批次：导入 / 恢复 / 跳过 / 未匹配。

## 管理员价值

- 管理员可以追溯余额恢复后有多少 pending usage 被补扣、补结算。
- 同步历史不再把恢复入账混在 imported 中，售出收入和共享收益复盘更清楚。
- 系统可用性巡检可以直接展示最近恢复数量，便于判断 pending usage 风险是否正在收敛。

## 验证命令

```bash
pnpm.cmd db:generate
pnpm.cmd --filter @zyz/api run typecheck
pnpm.cmd --filter @zyz/admin run typecheck
pnpm.cmd --filter @zyz/api test
pnpm.cmd --filter @zyz/admin test
pnpm.cmd build
```
