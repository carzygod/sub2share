# 提现结算余额护栏

实现日期：2026-06-09

## 背景

后台已经支持创建提现记录和变更提现状态，但此前没有校验供给方是否真的拥有足够的 `available` 结算金额，也没有限制提现状态流转。管理员误操作时可能录入超额提现，或把终态提现重新改回处理中状态。

## 已实现范围

- 创建提现时校验金额不得低于 `MIN_WITHDRAWAL_AMOUNT`。
- 创建 `pending`、`approved`、`paid` 提现时校验供给方可提现金额。
- 可提现金额计算方式：

```text
available settlements - pending/approved/paid withdrawals
```

- `paid` 状态必须提供 `payoutRef`。
- 提现状态流转收紧为：
  - `pending -> approved | rejected | cancelled`
  - `approved -> paid | cancelled`
  - `paid`、`rejected`、`cancelled` 为终态
- 后台提现列表的操作按钮按当前状态展示，避免触发无效流转。

## 边界

该能力防止超额创建/审批/打款提现，并把已创建的 pending/approved/paid 提现视为占用可提现额度。逐条结算分配和核销能力见 `docs/withdrawal-settlement-allocation.md`。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
