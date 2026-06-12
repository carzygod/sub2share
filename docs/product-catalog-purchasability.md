# 商品目录可购买性巡检

实现日期：2026-06-10

## 背景

当前用户下单链路支持两类可直接开通的价格：固定价格套餐，以及 `pay_as_you_go` 商品的按量价格。非按量商品如果存在 active 价格但缺少固定价格，公开展示后会导致用户点击购买时失败。

## 已实现范围

- 公开接口 `GET /api/products` 只返回至少存在一个可直接开通价格的 active 商品。
- 公开接口暴露普通商品的 active 固定价格档位。
- 公开接口暴露 `pay_as_you_go` 商品的 active 价格档位，允许 `fixedPrice=null`。
- `GET /api/admin/system-health` 新增检查项：`productCatalog` / `商品目录`。
- 巡检扫描最近最多 200 个 active 商品，返回最多 50 条 issue 样本。
- 巡检识别：
  - active 商品没有 active 价格。
  - active 普通商品有 active 价格但没有任何可直接购买的固定价格。
  - active 普通商品价格缺少 `fixedPrice`，会被公开目录隐藏。

## 管理价值

- 用户端不再展示当前下单链路无法购买的价格档位，同时可以展示按量商品价格。
- 管理员可以在可用性巡检中发现商品已 active 但不会进入公开可购买目录的配置问题。
- 该能力降低售前商品配置错误演变成订单失败或售后工单的概率。

## 后续边界

真实支付单仍需要后续扩展。当前保护以“不向用户展示当前购买链路不支持的价格”为准。

## 2026-06-12 扩展：管理员首页商品巡检定位

- `GET /api/admin/dashboard` 的关键巡检预览会保留 `productCatalog` 问题中的 `productId`、`productName` 和 `priceId`。
- 管理员首页点击带商品定位的 `productCatalog` warning 时，会直接打开商品管理列表并按商品定位字段搜索。
- 首页摘要同步显示商品和价格定位，方便管理员从总览页确认是哪一个可售商品缺少 ready Codex 交付资源。
- 完整可用性巡检页的商品问题行仍保留“打开商品”入口，首页与完整巡检页的商品维修路径保持一致。

## 2026-06-12 扩展：商品风险直达共享资源修复

- `productCatalog` issue 会继承系统当前识别出的 Sub2/OpenAI 修复候选账号。
- Admin 首页在商品目录 warning 行同时提供“打开商品”和“打开共享资源”两个入口。
- “打开共享资源”会预填供给方、资源类型、生产范围、目标 Sub2 账号和推荐维修动作。
- 当存在目标 Sub2 账号时，共享资源创建表单会默认启用“创建后应用到 Sub2”和“应用后端到端自检”，减少商品可售但交付资源仍未 ready 的空窗。

## 2026-06-12 扩展：共享资源修复保留商品上下文

- 从商品目录 warning 打开共享资源时，系统会继续传递 `productId`、`productName` 和 `priceId`。
- 共享资源创建表单的修复诊断条会展示 `Product`，管理员提交前可以确认当前资源修复对应的受影响商品。
- 该能力覆盖 Admin 首页和完整可用性巡检页两条入口。

## 2026-06-13 扩展：Codex 可交付风险携带价格定位

- `productCatalog` 巡检在判断 active Codex 商品存在可购买价格但没有 ready production Codex shared resource 时，会把首个可购买价格 ID 写入 issue。
- Codex delivery readiness issue 的 id 会包含 `productId` 与 `priceId`，不再只能落到商品级别。
- Dashboard 预览、商品管理搜索、共享资源修复默认值、修复诊断条和凭据应用确认弹窗可以复用同一个价格定位字段。
- 该能力只补齐巡检证据和管理员排障上下文，不改变商品可购买性、下单闸门或共享资源 ready 判定。

## 2026-06-13 扩展：Codex 商品上架准入

- `productCatalog` 的 ready 资源语义已前移到管理员写入口。
- `POST /api/admin/products` 与 `PATCH /api/admin/products/:id` 默认阻止没有 ready production Codex shared resource 的 Codex 商品上架。
- `POST /api/admin/products/:id/prices` 与 `PATCH /api/admin/product-prices/:id` 默认阻止 active Codex 商品启用可购买价格。
- 管理员可以显式传入 `allowUnavailableDelivery=true` 覆盖，但该动作会作为商品或价格更新审计的一部分记录。

这样商品目录巡检从“发现 active 商品风险”补强为“默认阻止新的 active 商品风险进入目录”。
