# Pending Usage 积压巡检

实现日期：2026-06-10

## 背景

按量商品零预付开通后，Sub2 usage 是买家扣费、售出收入和供应商共享收益的共同来源。余额不足时 usage 会进入 `pending`，等待用户充值后由后续同步恢复扣费。若 pending usage 长期积压，管理员需要能在系统巡检中直接看到影响范围，而不是只依赖用量列表或账务对账人工筛选。

## 后端能力

`GET /api/admin/system-health` 新增检查项：

```text
pendingUsageBilling / Pending 用量账务
```

检查范围：

- 扫描非 smoke 数据中的 `UsageRecord(status=pending, buyerCharge>0)`。
- 汇总 pending usage 数量、买家待扣金额、供应商待结算金额和最早 usage 时间。
- 默认扫描最早的 200 条 pending usage。
- 返回最多 50 条 issue 样本。

状态规则：

- 没有 pending usage：`ok`。
- pending usage 位于 `low_balance`、`limited` 或其他非 active 租赁：`warning`。
- pending usage 仍位于 `active` 租赁：`error`，因为这意味着仍有未入账用量但租赁可能继续可用。

## 管理员价值

- 管理员可以在可用性巡检中直接看到待恢复账务规模。
- 售出收入、用户余额和供应商共享收益的滞留风险会形成独立健康信号。
- 与 `docs/pending-usage-recovery.md` 互补：恢复逻辑负责“再次同步时修复”，巡检负责“发现仍未恢复的积压”。

## 设计边界

- 巡检只读，不自动扣费。
- 真正扣费恢复仍通过 Sub2 usage 同步任务执行。
- 该检查不会把 smoke 自检 usage 计入运营健康结果。
