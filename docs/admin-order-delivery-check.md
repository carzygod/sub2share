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
- 全局 `可用性巡检` 已新增 `salesDelivery` 检查项，用于批量发现近期应交付订单的交付阻断。

## 管理员价值

- 管理员可以在订单详情中直接判断售出交付是否完整。
- 售后排障时不必逐个区块拼接付款、租赁、Key、endpoint、钱包和反代请求证据。
- 该能力补强“售出情况”与 OpenAI/Codex 本地反代可用性的交叉核查闭环。

## 2026-06-13 扩展：订单租赁交付展示共享资源来源

- Codex 租赁会持久化 `supplierResourceId`，记录本次售出交付选中的共享资源。
- 订单详情与售出情况详情的 `租赁交付` 表新增共享资源列。
- 共享资源列展示资源 ID、Sub2 Account ID、资源状态和供给方邮箱。
- 管理员可以从订单详情直接打开对应共享资源。

这样售出订单的交付核查不仅能看到 endpoint 和 Sub2 Key，也能直接确认是哪一个供给资源负责该租赁。

## 验收方式

```bash
npm --prefix user/apps/api run typecheck
npm --prefix user/apps/admin run typecheck
npm --prefix user/apps/api run build
npm --prefix user/apps/admin run build
```

## 2026-06-13 扩展：售出交付巡检纳入共享资源归因

- 全局 `salesDelivery` 巡检会检查 Codex 租赁是否存在 `supplierResourceId`。
- 缺少归因时返回 `rental_missing_supplier_resource`，并携带 `orderId`、`rentalId`、`userId`、`userEmail` 与共享资源修复上下文。
- 已有关联但资源不是 `online` 或缺少 `sub2AccountId` 时返回 `rental_supplier_resource_not_ready`，并携带 `resourceId`、资源状态、供应方邮箱和 Sub2 Account ID。
- Dashboard 交付阻断摘要会保留这些订单/租赁/用户定位字段，便于管理员从首页直接进入共享资源修复。

这样订单交付核查从单笔详情延伸到全局巡检，既能发现 endpoint/key 缺口，也能发现租赁背后的共享资源归因缺口。

## 2026-06-13 扩展：管理员可直接修复租赁共享资源归因

- 后端新增 `PATCH /api/admin/rentals/:id/supplier-resource`，用于为租赁绑定或清空 `supplierResourceId`。
- 默认 `requireReady=true`，Codex 租赁只能绑定 ready 的生产共享资源：资源在线、存在 Sub2 Account，并具备 active OpenAI refresh token 凭据。
- 管理员需要处理历史迁移或人工补录时，可以显式传入 `requireReady=false`，但接口仍会校验资源存在且 `resourceType` 与租赁一致。
- Admin 租赁列表和租赁详情新增共享资源归因表单，支持输入共享资源 ID、执行 ready 校验和清空错误归因。
- 每次变更都会记录 `admin.rental.supplier_resource` 审计日志，保留变更前后的资源、供应方和 Sub2 Account 上下文。

这样 `salesDelivery` 从“发现租赁资源归因缺口”延伸到“管理员可在租赁侧完成归因修复”，售出交付闭环不再依赖线下数据库修补。
