# 管理员订单交付核查摘要

实现日期：2026-06-10

## 背景

售出订单详情已经展示订单项、租赁、API Key、钱包流水和反代请求，但管理员仍需要逐行判断“这笔订单是否已经具备可用的 OpenAI/Codex 交付”。例如已付款但没有租赁、租赁缺少 endpoint、Sub2 Key 缺失、本地 API Key 未激活或钱包余额低于反代准入门槛，都会导致用户拿到的售出服务不可用。

## 已实现范围

- `GET /api/admin/orders/:id` 响应新增 `deliverySummary`。
- `deliverySummary.status` 汇总全部检查项，取值为 `ok`、`warning`、`error`。
- `deliverySummary.summary` 返回检查项数量、租赁数量、active 租赁数量、API Key 数量、active API Key 数量和关联反代请求数量。
- `deliverySummary.checks` 覆盖：
  - 付款状态
  - 租赁交付
  - OpenAI endpoint
  - Sub2 Key
  - 本地 active API Key
  - 钱包准入
  - 反代请求证据
- 已取消、已退款订单不再要求 endpoint、Sub2 Key、本地 API Key 或钱包准入仍然可用，避免售后关闭状态被误判为交付错误。
- 管理后台订单详情新增 `交付核查` 摘要和明细表。
- `订单` 与 `售出情况` 详情复用同一核查视图。

## 管理员价值

- 管理员可以在订单详情中直接判断售出交付是否完整。
- 售后排障时不必逐个区块拼接付款、租赁、Key、endpoint、钱包和反代请求证据。
- 该能力补强“售出情况”与 OpenAI/Codex 本地反代可用性的交叉核查闭环。

## 验收方式

```bash
npm --prefix user/apps/api run typecheck
npm --prefix user/apps/admin run typecheck
npm --prefix user/apps/api run build
npm --prefix user/apps/admin run build
```
