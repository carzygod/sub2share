# 管理员审计日志横向钻取

实现日期：2026-06-12

## 背景

审计日志记录了管理员、认证、Sub2/OpenAI 反代、共享资源、商品、订单、余额、结算和提现等关键操作，是系统可用性复查与问题追溯的中心证据。此前 `操作审计` 页面只能查看操作者、动作、对象、摘要、来源和时间，管理员需要复制对象 ID 再切换到对应页面筛选，排查路径较长。

## 已实现范围

- `操作审计` 列表新增 `操作` 列。
- 每条日志可按操作者 ID 打开用户详情。
- 按 `objectType/objectId` 直接映射已有管理入口：
  - `auth` / `user` -> 用户管理。
  - `wallet` -> 余额管理。
  - `order` -> 订单管理。
  - `rental` -> 租赁通道。
  - `api_key` -> API Key 管理。
  - `product` -> 商品配置。
  - `supplier_resource` -> 共享资源详情。
  - `settlement` -> 结算管理。
  - `withdrawal` -> 提现管理。
  - `sub2_account` -> Sub2/OpenAI 反代状态。
  - `sub2_proxy` -> API Key 管理。
- 从审计 `before/after` 载荷中派生常见关联入口：
  - `userId`、`walletId`、`orderId`、`rentalId`、`apiKeyId`、`apiKeyPrefix`。
  - `productId`、`resourceId`、`supplierResourceId`。
  - `usageRecordId`、`usageId`、`sub2RequestId`、`upstreamRequestId`。
  - `settlementId`、`withdrawalId`、`sub2AccountId`、`accountId`。
- 对 Sub2 本地反代自检日志解析 `localProxy.proxyRequestLogs[]`，优先打开失败的反代请求记录。
- 对 `product_price` 日志使用载荷中的 `productId` 打开商品，而不是停留在价格 ID 文本。
- 操作按钮复用已有列表筛选、详情加载和权限边界，不新增绕过后台 API 的隐藏入口。

## 管理价值

- 管理员可从任一审计记录快速串联用户、售出订单、余额、租赁、API Key、共享资源、Sub2 状态、反代请求、用量、结算和提现。
- 对当前线上 `sub2`、`resourceCredentials`、`localProxySmoke` 等健康问题，审计记录可以直接跳到失败 smoke 请求、Sub2 状态或相关资源入口。
- 排障和合规复核路径从“复制 ID -> 切换页面 -> 手动筛选”缩短为审计页内点击跳转。

## 验证

- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/admin test`
- `pnpm.cmd build`
