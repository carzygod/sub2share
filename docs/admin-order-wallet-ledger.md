# 管理员订单钱包流水核对

实现日期：2026-06-10

## 背景

售出订单的售后处理需要同时核对订单状态、租赁交付、API Key、钱包扣款和退款流水。此前订单详情已经展示订单项、租赁、Key 和状态历史，但关联钱包流水需要管理员跳转到 `余额流水` 页面并手工搜索订单 ID。

本次补齐订单详情中的钱包流水核对入口，让售出情况和余额情况可以在同一个订单详情面板中闭环复查。

## 后端接口

- 增强接口：`GET /api/admin/orders/:id`
- 权限要求：`operator` 或 `admin`
- 响应新增：
  - `walletTransactions`：该订单 `refType=order`、`refId=orderId` 的最近 50 条钱包流水。
  - `walletTransactionSummary`：该订单关联钱包流水的数量与金额汇总。

## 管理员入口

管理后台订单详情增强：

- 详情摘要新增钱包流水数量和流水金额。
- 新增 `钱包流水` 区块，展示最近扣款、退款等关联流水。
- 每条流水展示类型、金额、变动后余额、用户、备注和时间。
- 订单取消或退款后，后台仍会重新打开订单详情，因此新流水会随详情刷新展示。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/admin run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/admin run build`

功能验证建议：

1. 进入后台 `售出情况` 或 `订单`。
2. 打开一笔已付款订单详情。
3. 确认 `钱包流水` 区块展示 `purchase rental` 扣款流水。
4. 对可退款订单执行退款。
5. 重新打开详情，确认出现 `refund` 流水且摘要数量/金额更新。
