# 系统巡检售出交付检查

实现日期：2026-06-10

## 背景

单笔订单详情已经有 `deliverySummary`，但管理员仍需要打开具体订单才能发现“已付款或 active 订单没有完成交付”的问题。系统巡检需要把这类售出交付阻断提升为全局健康信号，避免交付缺口长期停留在订单列表中。

## 已实现范围

- `GET /api/admin/system-health` 新增检查项：`salesDelivery` / `售出交付`。
- 巡检扫描 `paid`、`provisioning`、`active` 状态订单，默认最多扫描最近 200 条。
- 已取消、已退款和其他终态订单不纳入交付可用性要求。
- 检查以下阻断：
  - 应交付订单没有租赁。
  - `active` 订单没有 active 租赁。
  - 租赁缺少 `endpointUrl`。
  - 租赁缺少 `sub2KeyId`。
  - 租赁缺少 active 本地 API Key。
- 巡检返回命中数、扫描数、是否截断、问题订单数、各类问题计数，以及最多 50 条问题样本。

## 管理员价值

- 管理员可以在 `可用性巡检` 页面直接发现售出交付阻断。
- 该检查补齐订单详情逐单核查之外的全局守望能力。
- 售后或运营无需先知道具体订单 ID，也能发现近期应交付订单的 endpoint、Sub2 Key 或 API Key 缺口。

## 验收方式

```bash
npm --prefix user/apps/api test
npm --prefix user/apps/api run typecheck
npm --prefix user/apps/admin run typecheck
npm --prefix user/apps/api run build
npm --prefix user/apps/admin run build
```
