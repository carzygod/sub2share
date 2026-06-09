# 订单退款幂等与并发保护

## 背景

管理员后台已经支持订单退款，但退款链路会影响订单状态、租赁状态、API Key 状态和买家钱包余额。此前逻辑会在事务外检查是否已有退款流水，并在事务内回充钱包；并发退款请求可能同时看到“尚未退款”，进而重复回充。

## 数据库兜底

新增迁移：

```text
user/prisma/migrations/0005_order_refund_unique/migration.sql
```

迁移增加部分唯一索引：

```text
WalletTransaction_order_refund_unique
```

约束含义：同一个 `refType=order`、`type=refund`、`refId=订单 ID` 只能存在一条退款钱包流水。

## 接口行为

`POST /api/admin/orders/:id/refund` 现在会：

1. 先检查是否已有订单退款流水。
2. 如果订单已 `refunded` 且已有退款流水，返回重放结果，不再次回充。
3. 如果已有退款流水但订单、租赁或 API Key 状态尚未收敛，只收敛状态，不再次回充。
4. 没有退款流水时，先用条件更新把订单从可退款状态占用为 `refunding`。
5. 只有成功占用订单的请求才会回充钱包并创建退款流水。
6. 钱包回充使用数据库原子更新：`availableBalance + paidAmount`，`totalSpent = max(totalSpent - paidAmount, 0)`。
7. 退款完成后将订单、租赁和本地 API Key 收敛为退款/停用状态，并尽力停用 Sub2 Key。

如果另一笔退款正在进行，接口返回 `refund_in_progress`。

## 可用性结论

该能力补强了 `WALLET-002` 和管理员售后入口：退款操作可以安全重试，不会因为重复点击或并发请求重复回充买家钱包。
