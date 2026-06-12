# Codex 售出交付 Ready 资源准入

实现日期：2026-06-12

## 背景

系统已经把共享资源的 `online` 状态与真实可交付的 ready online 口径拆开：生产 Codex 资源必须同时具备 `status=online`、有效 `sub2AccountId`、active `openai_refresh_token` 资源凭据，才可视为可交付资源。

但售出交付链路此前仍会直接创建 Sub2 key：用户下单、管理员重试失败订单、租赁换钥匙都没有在调用 Sub2 前确认本地资源池是否存在 ready Codex 资源。这样可能出现“订单/租赁已交付 key，但生产共享资源不可用”的经营与可用性偏差。

## 已实现范围

- 新增 `resource-delivery-readiness` 通用 helper。
- 对 Codex 资源类型，交付前查询生产 ready online 共享资源：
  - `resourceType=codex`
  - `status=online`
  - `sub2AccountId` 非空
  - 排除内部巡检资源 `admin-disabled-smoke-resource`
  - 资源凭据为 `credentialType=openai_refresh_token` 且 `status=active`
- 以下入口在创建 Sub2 key 之前执行准入：
  - `POST /api/orders`
  - `POST /api/admin/orders/:id/retry-provision`
  - 租赁 API Key rotation
- 当没有 ready Codex 资源时，接口返回 `503 codex_resource_not_ready_for_delivery`，并在 details 中返回要求的资源状态、凭据类型、凭据状态和排除的内部资源标识。
- 非 Codex 资源类型暂不受该准入影响。
- 用户下单路径会在钱包扣款和订单/租赁写入前完成检查，避免资源不可交付时先扣款再回滚。
- 管理员重试路径会在订单状态切换、钱包重新扣款和 Sub2 key 创建前完成检查。
- 下单与管理员重试的订单状态历史会记录本次匹配到的 `supplierResourceId`，便于后续审计交叉核查。
- `GET /api/admin/system-health` 的 `productCatalog` 巡检会在 active Codex 商品已有可购买价格、但没有 ready Codex 交付资源时返回 warning：
  - `readyCodexDeliveryResources=0`
  - `codexProductsWithoutReadyDeliveryResources>0`
  - issue type 为 `active_codex_product_without_ready_delivery_resource`
  - issue 携带共享资源修复入口字段和 `repairAction=apply_openai_refresh_token_to_sub2_account`
- `GET /api/products` 会把同一套 readiness 暴露给买家侧：
  - `deliveryRequired`
  - `deliveryReady`
  - `readyDeliveryResources`
  - `deliveryBlockedReason`
- 买家 Web 套餐页在 `deliveryReady=false` 时显示资源池暂不可交付提示，并禁用开通按钮。

## 管理员价值

- 售出情况不再只依赖 Sub2 key 是否创建成功，还会先确认本地生产 Codex 资源池具备可交付前提。
- 当前线上没有 ready Codex 资源时，新的购买和重试交付会直接暴露明确错误，而不是继续制造不可用租赁。
- 该能力与 `resources.readyOnlineCodexResources`、资源创建/配置/凭据/测试闸门保持同一套语义，减少状态口径不一致。

## 验收方式

```bash
pnpm --filter @zyz/api exec node --import tsx --test tests/resource-delivery-readiness.test.ts
pnpm --filter @zyz/api typecheck
pnpm --filter @zyz/api test
```

本次本地验收结果：

- `resource-delivery-readiness.test.ts`：4/4 通过。
- `@zyz/api typecheck`：通过。
- `@zyz/api test`：103/103 通过。

2026-06-12 补充验收：

- `resource-delivery-readiness.test.ts`：6/6 通过。
- `@zyz/api typecheck`：通过。
- `@zyz/api test`：105/105 通过。
- `@zyz/api build`：通过。

2026-06-12 买家目录补充验收：

- `resource-delivery-readiness.test.ts`：8/8 通过。
- `@zyz/api typecheck`：通过。
- `@zyz/web typecheck`：通过。
- `@zyz/api test`：107/107 通过。
- `@zyz/web build`：通过。
- `@zyz/api build`：通过。
