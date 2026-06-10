# 管理员失败订单重试开通

实现日期：2026-06-11

## 背景

用户下单后会先创建订单、租约和限额，再调用 Sub2API 创建托管用户 Key。本地已具备失败时关闭租约并退款的保护，但管理员此前无法在后台对失败订单执行重新开通，只能让用户重新下单或人工改库。

该能力补齐失败订单的售后修复闭环，让管理员可以在订单列表、售出订单列表和订单详情中直接重试 Sub2 开通。

## 后端接口

```text
POST /api/admin/orders/:id/retry-provision
```

权限：

- `admin`

请求体：

```json
{
  "note": "admin retry provisioning"
}
```

成功响应会返回：

- `order`：更新后的订单详情。
- `rental`：写入 Sub2 交付字段后的租约。
- `apiKey`：新创建的明文 API Key，仅本次响应返回。
- `apiKeyAvailable=true`。
- `sub2KeyId`。
- `walletDebited` 和 `debitTransactionId`。

## 重试前置条件

接口只允许处理满足以下条件的订单：

- 订单状态必须是 `failed`。
- 订单必须只有一个租约。
- 租约必须存在限额配置。
- 租约不能已经有 `sub2UserId`、`sub2KeyId`、`sub2KeyHash` 或 `endpointUrl`。
- 租约不能已经有 active 本地 API Key。
- 如果订单 `paidAmount > 0`，必须已存在该订单的 `refund` 钱包流水，证明初次失败开通已经完成退款。

这些限制用于避免重复开通、重复售卖或在账务未收敛时再次扣款。

## 状态和账务流程

重试开始时：

- 使用条件更新把订单从 `failed` 抢占为 `provisioning`。
- 写入状态历史 `admin.order.retry_provision.start`。
- 将租约状态恢复为 `active`。
- 如果订单金额大于 0，重新从买家钱包扣除 `paidAmount`，并创建 `consume` 钱包流水。

Sub2 开通成功后：

- 调用 `sub2Client.createKey()` 创建新的 Sub2 Key。
- 订单更新为 `active`。
- 租约写入 `sub2UserId`、`sub2KeyId`、`endpointUrl` 和 `sub2KeyHash`。
- 创建本地 `ApiKey`。
- 补齐 `Sub2Binding` 的 `user` 与 `api_key` 绑定。
- 写入状态历史 `admin.order.retry_provision.complete`。
- 写入审计日志 `admin.order.retry_provision`，不记录明文 API Key。

Sub2 开通或本地写回失败时：

- 尝试停用已经创建的 Sub2 Key。
- 订单回到 `failed`。
- 租约回到 `closed`。
- 如果本次重试已经扣款，立即创建 `adjustment` 钱包流水冲正本次重试扣款并回补余额。
- 冲正流水仍使用 `refType=order`、`refId=<orderId>`，会出现在订单详情的钱包流水中；不使用第二笔 `refund`，避免破坏同一订单正式退款唯一约束。
- 写入状态历史 `admin.order.retry_provision_failed`。
- 写入脱敏后的审计日志。

## 管理员入口

后台新增重试入口：

- 订单列表中，`failed` 订单显示 `Retry`。
- 售出订单列表中，`failed` 订单显示 `Retry`。
- 订单详情面板中，`failed` 订单显示 `Retry`。

操作成功后页面会刷新当前订单列表；如果详情面板已打开，也会刷新订单详情。新 API Key 只在成功提示中展示一次。

## 可用性结论

该能力让失败开通订单从“只能重新下单或改库”变成“管理员可审计、可扣款、可退款、可重试”的标准后台流程，进一步补齐售出情况、余额情况和 Sub2 交付状态之间的运维闭环。
