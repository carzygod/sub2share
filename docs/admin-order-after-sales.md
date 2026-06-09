# 管理员订单取消与退款

## 背景

管理员后台已经能查看售出订单、订单详情、租赁交付和用户余额，但此前缺少对异常订单的处理动作。对于“售出情况”管理来说，只能查看不能取消或退款，会导致售后处理仍需手工改库。

## 已实现接口

取消订单：

```text
POST /api/admin/orders/:id/cancel
```

退款订单：

```text
POST /api/admin/orders/:id/refund
```

权限：

- `admin`

请求体：

```json
{
  "note": "admin refunded order"
}
```

## 取消规则

取消只用于未付款、未交付的订单：

- 支持 `pending`、未付款的 `failed`。
- 若订单已有 `paidAmount` 或已产生租赁，接口返回 `order_requires_refund`，要求走退款流程。
- 成功后订单状态变为 `cancelled`。
- 写入审计日志 `admin.order.cancel`。

## 退款规则

退款用于已付款或已交付订单：

- 支持 `paid`、`provisioning`、`active`、`failed`、`refunding`、`closed`、`expired`。
- `refunded`、`cancelled` 终态订单不可重复处理。
- 订单 `paidAmount <= 0` 时拒绝退款。
- 若已经存在同一订单的 `refund` 钱包流水，不会再次回充钱包，避免重复退款。

成功处理后：

- 订单状态更新为 `refunded`。
- 租赁状态更新为 `refunded`。
- 本地 API Key 更新为 `inactive`。
- 买家钱包回充 `paidAmount`。
- 买家 `totalSpent` 扣回退款金额，但不会低于 `0`。
- 记录 `refund` 钱包流水，`refType=order`、`refId=<orderId>`。
- 尽力禁用对应 Sub2 Key。
- 写入审计日志 `admin.order.refund`。

## 后台入口

订单列表、售出订单列表和订单详情面板新增：

- `取消`
- `退款`

操作完成后会刷新当前订单列表；若详情面板已打开，也会刷新详情。

## 可用性结论

该能力让管理员可以在后台处理售出后的异常订单，不再需要直接改库来完成取消、退款、租赁停用、API Key 停用和余额回充。
