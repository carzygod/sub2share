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

## 2026-06-13 扩展：租赁共享资源归因可用性

- `salesDelivery` 巡检新增 Codex 租赁共享资源归因检查。
- `rental_missing_supplier_resource` 表示租赁没有 `supplierResourceId` 或关联资源缺失，修复动作是创建或修复生产 Codex 共享资源后为租赁补齐归因。
- `rental_supplier_resource_not_ready` 表示租赁已关联共享资源，但该资源不是 `online` 或缺少 `sub2AccountId`，修复动作是恢复该资源的交付可用性。
- 巡检 counters 新增 `rentalsMissingSupplierResource` 与 `rentalsWithUnavailableSupplierResource`。
- 问题样本会携带 `resourceList=true`、`resourceType=codex`、`resourceStatus`、`resourceScope=production`、供应方和 Sub2 Account 信息，供 Admin 首页和共享资源页复用。

这样全局售出交付巡检可以同时覆盖“交付字段是否完整”和“交付背后的生产共享资源是否可追溯、可维修”。

## 2026-06-13 扩展：租赁归因修复入口

- `rental_missing_supplier_resource` 的推荐修复路径现在可以落到 Admin 租赁管理页。
- 管理员使用 `PATCH /api/admin/rentals/:id/supplier-resource` 为租赁绑定 ready 的生产共享资源。
- `requireReady=true` 是默认值，会阻止 Codex 租赁绑定不可交付资源；历史修复需要强制补录时，可显式关闭 ready 校验。
- 清空错误归因同样走该接口，传入 `supplierResourceId=null`。
- 所有变更写入 `admin.rental.supplier_resource` 审计日志，便于复盘巡检问题从发现到修复的过程。

这样系统巡检发现的资源归因问题不需要数据库直改即可完成后台修复。
