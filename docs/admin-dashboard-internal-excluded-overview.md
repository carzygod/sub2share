# 管理员首页经营口径与内部记录排除数

## 背景

生产复查时发现，数据库中用户总数为 11，但管理员首页用户数显示为 1。代码复查确认首页管理摘要默认使用经营口径，会排除本地 OpenAI/Codex proxy smoke、历史 Codex health 和历史 e2e 记录。这能避免内部巡检数据污染用户、余额、售出和共享资源统计，但旧 UI 没有解释排除数量，管理员容易把经营口径误读为全库总量。

## 新行为

`GET /api/admin/dashboard` 的 `managementOverview` 新增 `internalExcluded`：

- `users`：全量用户数减去经营口径用户数。
- `wallets`：全量钱包数减去经营口径钱包数。
- `sales`：全量订单数减去经营口径订单数。
- `rentals`：全量租赁数减去经营口径租赁数。
- `sharing`：全量共享资源数减去经营口径共享资源数。

差值会被归零保护，避免并发写入或临时口径不一致导致负数。

Admin 首页管理摘要会在存在排除记录时显示一行口径提示，例如：

`经营口径已排除内部巡检记录：用户 10 / 钱包 9 / 订单 21`

默认列表入口仍进入经营口径列表，避免 smoke/e2e 记录影响日常运营；但管理员可以从系统健康和审计日志继续追踪内部巡检记录。

## 同步增强

本次同时把商品目录候选商品的 `productStatus` 继续透传到 Admin 上下文：

- 首页 `deliveryBlocker` 商品摘要显示候选商品状态。
- 系统健康关键巡检上下文包含 `productStatus`。
- 从商品目录或交付巡检打开共享资源修复入口时，资源创建默认值保留 `productStatus`。
- 资源创建确认上下文会显示 `status draft/offline`，减少管理员误激活不可交付商品的风险。

## 验证

- `pnpm.cmd --filter @zyz/api typecheck`
- `pnpm.cmd --filter @zyz/admin typecheck`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`
- `pnpm.cmd --filter @zyz/admin test`
