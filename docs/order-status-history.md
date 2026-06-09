# 订单状态历史

实现日期：2026-06-09

## 背景

订单状态原本只保留当前值，管理员在售后处理、退款重试、开通失败回滚时，很难追踪订单从哪个状态变更而来、由谁触发、失败或售后原因是什么。

## 已实现范围

- 新增 `OrderStatusHistory` 数据表，按订单记录 `fromStatus`、`toStatus`、操作者、原因、扩展 meta 和创建时间。
- 用户下单时记录 `null -> provisioning`。
- Sub2 Key 开通成功后记录 `provisioning -> active`。
- Sub2 Key 开通失败后记录 `provisioning -> failed`，并记录脱敏后的失败信息。
- 管理员取消订单时记录目标状态 `cancelled`。
- 管理员退款时记录 `refunding` 抢占和 `refunded` 完成。
- 退款重试发现已有退款流水但本地状态未收敛时，记录退款状态收敛。
- 管理后台订单详情新增“状态历史”表格，可查看状态流转、操作者、原因、meta 和时间。

## 数据模型

`OrderStatusHistory` 与 `Order` 为多对一关系，并带有：

- `@@index([orderId, createdAt])`：支撑订单详情按时间读取最近状态变化。
- `@@index([actorUserId, createdAt])`：预留按操作者追踪售后行为的查询能力。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 Prisma generate | 通过 |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
