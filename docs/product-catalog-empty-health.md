# 商品目录空目录健康告警

## 背景

生产复查时发现，系统健康里的 `productCatalog` 只检查 active 商品是否存在不可购买价格或不可交付 Codex 风险。当 active 商品数量为 0 时，巡检会返回 `ok`，但从真实售前可用性看，买家无法购买任何服务，这不应该显示为“公开商品目录可购买性正常”。

## 新行为

`inspectProductCatalogReadiness()` 在 `matched=0` 时新增目录级 warning：

- `type=empty_active_product_catalog`
- `productId=null`
- `productName=null`
- `priceId=null`
- `emptyActiveProductCatalog=1`
- `actionHint=Create or activate at least one purchasable product before treating the storefront as sellable.`

该 issue 不伪造商品定位。Dashboard 仍会把 `productCatalog` 放入关键巡检预览，管理员点击后进入商品配置入口，新建或激活商品。

## 管理价值

- 空商品目录会被视为售前可用性问题，而不是正常状态。
- 当前生产 `activeCodexProducts=0` 的情况会在系统健康里更清楚地暴露。
- 后续管理员完成 OpenAI refresh token、Codex 资源和 smoke 修复后，还能继续看到商品未上架这一独立阻断，避免“反代恢复但前台仍无商品可买”。

## 验证

- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`
- `pnpm.cmd --filter @zyz/api typecheck`
- `pnpm.cmd --filter @zyz/api test -- --runInBand`
