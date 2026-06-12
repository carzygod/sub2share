# 管理员商品售出横向钻取

实现日期：2026-06-12

## 背景

商品和价格是售卖入口的配置源，也是订单、租赁、API Key、用量和反代请求的上游上下文。此前 `商品与价格` 页面可以创建、编辑、上下架商品和价格，但管理员从单个商品或价格继续复核售出订单、租赁交付、用量扣费或反代请求时，仍需要复制 ID 后切换页面手动筛选。

## 已实现范围

- `GET /api/admin/orders` 搜索新增支持：
  - `OrderItem.productId`
  - `OrderItem.priceId`
  - `OrderItem.product.id`
  - `OrderItem.product.name`
- `GET /api/admin/sales` 搜索新增支持：
  - `OrderItem.productId`
  - `OrderItem.priceId`
  - `OrderItem.product.id`
  - `Rental.productId`
- `GET /api/admin/rentals` 搜索新增支持：
  - `Rental.productId`
  - `Rental.product.id`
  - `OrderItem.productId`
  - `OrderItem.priceId`
- `GET /api/admin/usages` 搜索新增支持：
  - `Rental.productId`
  - `Rental.product.id`
  - `Rental.order.items.productId`
  - `Rental.order.items.priceId`
- `GET /api/admin/proxy-requests` 搜索新增支持：
  - `Rental.orderId`
  - `Rental.productId`
  - `Rental.product.id`
  - `Rental.order.items.productId`
  - `Rental.order.items.priceId`
- `商品与价格` 列表新增商品级钻取操作：
  - 售出。
  - 订单。
  - 租赁。
  - 用量。
  - 反代。
- 每个价格档位新增价格级钻取操作：
  - 售出。
  - 订单。
  - 租赁。
  - 用量。
  - 反代。
- `售出情况` 的商品排行新增操作列，可从排行行打开商品配置、筛选售出、订单、租赁和用量。

## 管理价值

- 管理员可以从商品配置直接复核该商品或某个价格档位的售出情况、交付租赁、用量账务和反代证据。
- 商品下架、价格变更、套餐限额争议、交付失败和 `/v1/responses` 排障路径更短。
- 复用既有列表筛选、详情加载和权限边界，不新增绕过后台入口的隐藏操作。

## 验证

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/api test`
- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd build`
