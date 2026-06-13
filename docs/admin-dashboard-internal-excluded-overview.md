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

## 全量列表入口

为了满足管理员“能管理所有情况”的要求，经营列表新增显式全量模式：

- 支持 `action=all` 的接口：
  - `GET /api/admin/users`
  - `GET /api/admin/wallets`
  - `GET /api/admin/wallet-transactions`
  - `GET /api/admin/orders`
  - `GET /api/admin/sales`
  - `GET /api/admin/rentals`
  - `GET /api/admin/resources`
  - `GET /api/admin/usages`
  - `GET /api/admin/api-keys`
- 默认不传 `action` 时继续使用经营口径，排除内部 smoke/e2e/health 记录。
- Admin 前端在这些列表的筛选条中提供“包含内部巡检”选项，提交后会携带 `action=all`。
- API Key 批量启停仍保持经营口径，避免误批量处理内部巡检 Key。

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
- `pnpm.cmd --filter @zyz/api test -- --runInBand`

## 2026-06-13 生产发布复查

- Commit：`fb1ee66db2973f5ac3c78e6e7c1f79091060ce8d`
- Release marker：`deployed_at=20260613T034449Z`
- 部署脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：146/146 通过。
  - Admin tests：17/17 通过。
  - Workspace build：通过。
  - `/health`、`/ready`、Web、Admin 探针均返回 200。
- 生产 dashboard 复查：
  - `managementOverview.users.total=1`
  - `managementOverview.wallets.total=1`
  - `managementOverview.sales.total=1`
  - `managementOverview.rentals.total=1`
  - `managementOverview.sharing.total=0`
  - `managementOverview.internalExcluded.users=10`
  - `managementOverview.internalExcluded.wallets=10`
  - `managementOverview.internalExcluded.sales=21`
  - `managementOverview.internalExcluded.rentals=21`
  - `managementOverview.internalExcluded.sharing=1`
- 商品目录上下文复查：
  - `latestSystemHealth.deliveryBlocker.productName=Codex 标准租赁`
  - `latestSystemHealth.deliveryBlocker.productStatus=offline`
  - `latestSystemHealth.deliveryBlocker.priceId=d231fcef-2dc6-4317-b44e-a93cad3ab0ea`
  - `productCatalog.primaryIssue.type=empty_active_product_catalog`
- 系统健康仍为 `24 ok / 2 warning / 3 error`。剩余阻断仍是有效 OpenAI refresh token、active Sub2 OpenAI 账号和 online Codex 共享资源缺失。

## 2026-06-13 全量列表入口生产复查

- Commit：`7340b295cc416941f5eef1bd7981a55aa13a07b0`
- Release marker：`deployed_at=20260613T035857Z`
- Systemd 服务：`zyz-api`、`zyz-admin`、`zyz-web`、`sub2api` 均为 `active`。
- 发布脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：147/147 通过。
  - Admin tests：17/17 通过。
  - Workspace build：通过。
  - `/health`、`/ready`、Web、Admin 探针均返回 200。
- 线上管理列表复查：
  - `GET /api/admin/users`：默认 `total=1`，`action=all` 为 `total=11`。
  - `GET /api/admin/wallets`：默认 `total=1`，`action=all` 为 `total=11`。
  - `GET /api/admin/wallet-transactions`：默认 `total=3`，`action=all` 为 `total=22`。
  - `GET /api/admin/orders`：默认 `total=1`，`action=all` 为 `total=22`。
  - `GET /api/admin/sales`：默认 `total=1`，`action=all` 为 `total=22`。
  - `GET /api/admin/rentals`：默认 `total=1`，`action=all` 为 `total=22`。
  - `GET /api/admin/usages`：默认 `total=0`，`action=all` 为 `total=0`。
  - `GET /api/admin/api-keys`：默认 `total=2`，`action=all` 为 `total=19`。
- Admin 前端产物复查：
  - `http://127.0.0.1:3101/` 返回 200。
  - 当前 Admin JS 产物包含“经营口径”和“包含内部巡检”两个筛选文案。
- 实时系统健康：
  - `status=error`，`summary=24 ok / 2 warning / 3 error`。
  - `productCatalog` warning：`Codex 标准租赁` 仍为 `offline`，当前活跃可售目录为空。
  - `resources` warning：生产口径缺少 online Codex 共享资源。
  - `resourceCredentials` error：`activeOpenAiRefreshTokens=0`，没有可用于 Codex 资源的有效 OpenAI refresh token。
  - `sub2` error：`openai_group_has_no_active_accounts`，Sub2 网关可达但 OpenAI 账号不可调度。
  - `localProxySmoke` error：`models` 探针 200，`responses` 探针 503 `api_error`，根因仍受有效上游 OpenAI OAuth 账号/refresh token 缺失影响。
