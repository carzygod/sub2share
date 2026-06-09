# 钱包原子扣费与流水一致性

## 背景

钱包余额是购买、OpenAI/Codex 反代用量入账、管理员调账和售出对账的共同基础。此前部分链路采用“先读余额，再计算新余额，再写回”的方式。并发下，不同请求可能基于同一份旧余额计算，导致余额或累计消费被覆盖，进而影响售出情况和用量账务可信度。

## 修复范围

本次修复覆盖以下写入点：

- `POST /api/orders` 下单扣费。
- Sub2 usage 同步入账扣费。
- `POST /api/wallet/recharge` 用户充值。
- `POST /api/admin/users/:id/wallet-adjust` 管理员余额调整。

## 实现方式

下单扣费和 usage 扣费改为数据库条件更新：

```text
availableBalance >= amount
availableBalance decrement amount
totalSpent increment amount
```

只有数据库实际更新 1 行时才视为扣费成功。扣费成功后重新读取钱包余额，并将该余额写入 `WalletTransaction.balanceAfter`。

余额不足或钱包不存在时：

- 下单接口返回 `insufficient_balance`，事务回滚，不创建有效订单扣款流水。
- usage 同步保留 `pending` usage，将租赁标记为 `low_balance`，等待后续充值或人工处理。

充值和正向管理员调账改为 `increment`，负向管理员调账改为带余额条件的 `decrement`，避免并发调账把余额扣成负数。

## 可用性结论

该能力强化了 `WALLET-002` 和 `WALLET-003`：钱包扣费不再依赖旧读数覆盖写回，余额不可负和流水 `balanceAfter` 的可信度更高，订单、用量、余额和售出情况更容易对账。
