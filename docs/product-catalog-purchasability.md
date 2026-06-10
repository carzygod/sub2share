# 商品目录可购买性巡检

实现日期：2026-06-10

## 背景

当前用户下单链路仍以固定价格直接购买为准：`POST /api/orders` 要求所选 `ProductPrice.fixedPrice` 存在。若数据库中存在 active 商品或 active 价格但缺少固定价格，公开商品目录展示后会导致用户点击购买时失败。

## 已实现范围

- 公开接口 `GET /api/products` 只返回具备 active 固定价格的 active 商品。
- 公开接口只暴露 `status=active` 且 `fixedPrice != null` 的价格档位。
- `GET /api/admin/system-health` 新增检查项：`productCatalog` / `商品目录`。
- 巡检扫描最近最多 200 个 active 商品，返回最多 50 条 issue 样本。
- 巡检识别：
  - active 商品没有 active 价格。
  - active 商品有 active 价格但没有任何可直接购买的固定价格。
  - active 价格缺少 `fixedPrice`，会被公开目录隐藏。

## 管理价值

- 用户端不再展示当前下单链路无法购买的价格档位。
- 管理员可以在可用性巡检中发现商品已 active 但不会进入公开可购买目录的配置问题。
- 该能力降低售前商品配置错误演变成订单失败或售后工单的概率。

## 后续边界

按量计费商品、零预付费开通和真实支付单仍需要后续扩展下单链路。当前保护以“不向用户展示当前购买链路不支持的价格”为准。

