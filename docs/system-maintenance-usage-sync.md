# 系统维护触发 Sub2 用量同步

实现日期：2026-06-10

## 背景

`POST /api/admin/system-maintenance/run` 已经能收敛过期租赁、异常反代 Key、到期结算、Sub2 绑定和 stale smoke 数据。但系统性可用性复查还需要尽快把 Sub2 usage 拉回本地，否则用户余额、售出收入、供应商结算和 pending usage 巡检会滞后。

虽然管理后台已有独立的 Sub2 usage 同步按钮，管理员运行一键维护后仍需要记得再手动点一次，容易漏掉账务侧收敛。

## 已实现范围

- `systemMaintenanceSchema` 新增 `syncSub2Usage`，默认启用。
- 系统维护流程会调用 `syncSub2UsageOnce(undefined, { persistCursor: true })`：
  - 复用持久化 cursor。
  - 写入 `BillingSyncRun`。
  - 更新 `BillingSyncState`。
  - 复用既有 usage 幂等、钱包扣费、pending 恢复和供应商结算逻辑。
- Sub2 usage 同步失败不会中断整次系统维护：
  - `actions.syncSub2Usage.ok=false`
  - `error` 会脱敏并限制长度。
  - 维护动作仍继续生成新的系统健康快照。
- 管理后台 `可用性巡检` 页的最近维护结果新增 `用量同步` 指标。
- 维护完成 toast 会显示 usage imported/recovered，或提示 usage sync failed。

## 管理员价值

- 管理员运行一次系统维护即可同时收敛反代交付、账务入账、结算释放和巡检快照。
- 余额情况、售出收入、供应商结算和 pending usage 风险更容易在同一轮维护后变成最新状态。
- Sub2 短时不可用时，维护入口仍会完成其他本地修复动作，并把同步失败暴露给管理员。

## 边界

- 该动作不会绕过账务幂等规则，不会直接手工改钱包余额。
- 真正的 usage 数据仍来自 Sub2API；如果 Sub2API 不可达或 OpenAI/Codex 上游没有产生 usage，同步结果可能为 0 或失败。
- 自动定时同步仍由 `SUB2_USAGE_SYNC_INTERVAL_MS` 控制，本维护动作只是管理员主动触发的一次同步。
