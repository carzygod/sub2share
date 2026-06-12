# 管理员商品交付状态

实现日期：2026-06-12

## 背景

买家商品目录和下单链路已经能识别 `codex_resource_not_ready_for_delivery`，系统健康页也能提示 active Codex 商品缺少 ready production Codex shared resource。但管理员商品管理页仍只展示商品上下架状态，无法在商品列表和导出表中直接看到当前商品是否可交付。

为了让运营处理路径闭环，管理员商品接口、商品表格和 CSV 导出需要消费同一套 ready Codex 资源口径。

## 已实现范围

- `GET /api/admin/products`、`GET /api/admin/products/:id`、`POST /api/admin/products`、`PATCH /api/admin/products/:id` 都会为商品补充：
  - `deliveryRequired`
  - `deliveryReady`
  - `readyDeliveryResources`
  - `deliveryBlockedReason`
- Codex 商品使用与买家目录、下单交付闸门一致的 ready 资源口径：
  - `resourceType=codex`
  - `status=online`
  - `sub2AccountId` 非空
  - 排除内部巡检资源 `admin-disabled-smoke-resource`
  - active `openai_refresh_token` 凭据
- 管理员商品表新增“交付”列：
  - `deliveryReady=false` 显示 `blocked`。
  - ready 资源数量显示为 `ready N`。
  - 阻塞原因显示 `codex_resource_not_ready_for_delivery`。
  - 非 Codex 商品显示 `not required`。
- 商品 CSV 导出新增 `deliveryReady`、`readyDeliveryResources`、`deliveryBlockedReason` 字段。

## 验收方式

```bash
pnpm --filter @zyz/api typecheck
pnpm --filter @zyz/admin typecheck
pnpm --filter @zyz/api test
pnpm --filter @zyz/admin test
pnpm --filter @zyz/admin build
pnpm --filter @zyz/api build
```

上线后可通过管理员登录态调用：

```bash
curl -sS http://127.0.0.1:4100/api/admin/products
```

当生产环境仍没有 ready Codex 资源时，`Codex 标准租赁` 应返回：

- `deliveryRequired=true`
- `deliveryReady=false`
- `readyDeliveryResources=0`
- `deliveryBlockedReason=codex_resource_not_ready_for_delivery`
