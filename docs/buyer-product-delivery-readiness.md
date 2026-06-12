# 买家商品目录交付状态

实现日期：2026-06-12

## 背景

Codex 售出交付已经在下单、管理员重试交付和租赁换钥匙前检查 ready production Codex shared resource。但如果买家商品目录仍把 Codex 套餐展示为可直接开通，用户会在点击购买后才收到 `codex_resource_not_ready_for_delivery` 错误。

为了让买家侧体验与后端交付闸门一致，公开商品接口和 Web 套餐页需要提前暴露交付状态，并在资源池不可交付时禁用购买入口。

## 已实现范围

- `GET /api/products` 响应为每个商品补充：
  - `deliveryRequired`
  - `deliveryReady`
  - `readyDeliveryResources`
  - `deliveryBlockedReason`
- Codex 商品使用与下单闸门一致的 ready 资源口径：
  - `resourceType=codex`
  - `status=online`
  - `sub2AccountId` 非空
  - 排除内部巡检资源 `admin-disabled-smoke-resource`
  - active `openai_refresh_token` 凭据
- 当没有 ready Codex 资源时，Codex 商品仍可见，但 `deliveryReady=false`，`deliveryBlockedReason=codex_resource_not_ready_for_delivery`。
- 买家 Web 套餐卡片在 `deliveryReady=false` 时：
  - 展示资源池暂不可交付提示。
  - 禁用开通按钮。
  - 将按钮文案改为“暂不可开通”。
- 非 Codex 商品保持 `deliveryReady=true`，不受 Codex ready 资源闸门影响。

## 验收方式

```bash
pnpm --filter @zyz/api exec node --import tsx --test tests/resource-delivery-readiness.test.ts
pnpm --filter @zyz/api typecheck
pnpm --filter @zyz/web typecheck
pnpm --filter @zyz/api test
pnpm --filter @zyz/web build
pnpm --filter @zyz/api build
```

本次本地验收结果：

- `resource-delivery-readiness.test.ts`：8/8 通过。
- `@zyz/api typecheck`：通过。
- `@zyz/web typecheck`：通过。
- `@zyz/api test`：107/107 通过。
- `@zyz/web build`：通过。
- `@zyz/api build`：通过。
