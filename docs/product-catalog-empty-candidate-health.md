# 空商品目录候选商品定位

## 背景

`productCatalog` 已经会在 active 商品数量为 0 时返回 `empty_active_product_catalog` warning，避免公开商品目录为空却显示为正常。但线上复查发现，数据库中仍可能存在 draft/offline 商品和 active 价格。旧告警只返回目录级问题，管理员需要手动进入商品页再判断应该激活哪一个商品。

## 新行为

当没有 active 商品时，巡检会额外扫描非 smoke 商品中的 draft/offline 候选：

- 优先选择带可购买 active 价格的候选商品。
- 若没有可购买价格，则选择最近更新的候选商品。
- 告警会携带 `productId`、`productName`、`productStatus`、`priceId` 和 `resourceType`。
- 管理员首页和系统健康详情会保留这些字段，商品入口可以直接打开候选商品。

没有任何候选商品时，告警仍保持目录级 fallback：

- `productId=null`
- `productName=null`
- `productStatus=null`
- `priceId=null`

## 管理价值

- 空目录问题从“需要新建或激活商品”细化为“优先修复这个现有候选商品”。
- 线上有 draft/offline 商品时，管理员可以少一次人工搜索。
- `productStatus` 会进入 API 预览、共享字段白名单和 Admin 行模型，后续可以继续在 UI 上展示更明确的候选状态。

## 验证

- `pnpm.cmd --filter @zyz/admin typecheck`
- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd --filter @zyz/api typecheck`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`
- `pnpm.cmd --filter @zyz/api test -- --runInBand`
