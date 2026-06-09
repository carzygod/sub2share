# 商品价格消费上限

实现日期：2026-06-09

## 背景

系统已有 `RentalLimit.spendLimit` 和 `remainingSpend`，Sub2 Key 创建也支持 `spendLimit` 映射到上游 quota，但商品价格层此前没有配置入口。结果是管理员无法把“消费上限”作为套餐权益配置，用户下单后也不会把消费上限沉淀到租赁限额。

## 已实现范围

- `ProductPrice` 新增 `spendLimit` 字段。
- 新增迁移 `user/prisma/migrations/0007_product_price_spend_limit/migration.sql`。
- 管理员创建/更新价格时支持传入 `spendLimit`。
- 管理后台创建价格表单新增“消费上限”输入框。
- 管理后台商品价格列表展示消费上限。
- 买家端套餐卡片展示消费上限。
- 下单创建 `RentalLimit` 时写入：
  - `spendLimit = ProductPrice.spendLimit`
  - `remainingSpend = ProductPrice.spendLimit`
- Sub2 Key 创建时把 `ProductPrice.spendLimit` 作为 `spendLimit` 下发，进入 Sub2 quota。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 Prisma generate | 通过 |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 Web typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
| 本地 Web build | 通过 |

## 边界

该能力补齐固定价格套餐的消费上限配置、展示和下发。RPM/TPM 仍只存在于 `RentalLimit` 模型中，后续还需要为商品价格和 Sub2 适配层补齐配置入口及真实下发契约。
