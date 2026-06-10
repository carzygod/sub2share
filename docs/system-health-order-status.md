# 系统巡检订单状态样本

实现日期：2026-06-11

## 背景

`GET /api/admin/system-health` 的 `orders` 检查此前只统计 `failed` 和 `refunding` 订单数量。管理员能看到订单状态存在 warning，但无法从巡检页直接定位具体订单，也无法判断失败订单是否已经满足后台 `Retry` 重试开通条件。

本次补齐订单状态检查的问题样本，让失败开通订单、退款中订单和重试阻塞原因都能直接进入管理员修复路径。

## 已实现范围

- `orders` / `订单状态` 检查新增 `detail.issues`。
- 默认返回最近最多 50 条 `failed` 或 `refunding` 订单样本。
- 每条样本包含：
  - `orderId`
  - `userId`
  - `userEmail`
  - `rentalId`
  - `orderStatus`
  - `paidAmount`
  - `type`
  - `message`
- `failed` 订单会被区分为：
  - `failed_order_retry_candidate`：满足后台重试开通的前置条件。
  - `failed_order_manual_review`：存在重试阻塞原因，需要人工复查。
- `refunding` 订单会返回：
  - `refunding_order_review`：提示管理员复查退款收敛状态。

## 重试候选判定

`failed_order_retry_candidate` 要求：

- 订单只有一个租约。
- 租约存在限额配置。
- 租约没有 `sub2UserId`、`sub2KeyId`、`sub2KeyHash` 或 `endpointUrl`。
- 租约没有 active 本地 API Key。
- 如果 `paidAmount > 0`，订单已经存在原始 `refund` 钱包流水。

如果不满足上述条件，样本会返回 `failed_order_manual_review`，并在 `message` 中列出阻塞原因。

## 管理员入口

管理后台 `可用性巡检` 页已经能读取所有检查项的 `detail.issues`。订单状态样本包含 `orderId` 后，页面会显示 `打开订单` 操作。管理员打开订单详情后，可以继续查看交付核查、钱包流水、状态历史，并在满足条件时执行失败订单 `Retry`。

## 可用性结论

订单状态 warning 不再只是一个聚合计数。管理员可以从巡检页直接进入具体失败订单，判断是否能重试 Sub2 开通，或进入退款中订单复查账务收敛状态，进一步补齐售出情况和余额情况的可运维闭环。
