# 商品价格 RPM/TPM 限额下发

实现日期：2026-06-10

## 背景

OpenAI/Codex 本地反代入口已经支持租赁级 RPM/TPM 闸门，`RentalLimit` 也具备 `rpmLimit` 和 `tpmLimit` 字段。但商品价格层此前缺少对应配置，导致管理员只能在售后阶段手动修改已售租赁，无法把速率权益作为套餐的一部分提前定义。

## 已实现范围

- `ProductPrice` 新增 `rpmLimit` 和 `tpmLimit` 字段。
- 新增迁移 `user/prisma/migrations/0010_product_price_rate_limits/migration.sql`。
- 种子套餐为 Codex 标准月租写入默认 `rpmLimit=60`、`tpmLimit=120000`。
- 管理员创建/更新价格时支持传入 `rpmLimit` 和 `tpmLimit`。
- 管理后台创建价格表单新增 RPM/TPM 输入框。
- 管理后台商品价格摘要展示 RPM/TPM。
- 管理后台产品 CSV 导出新增套餐限额摘要，包含并发、RPM、TPM、请求数和消费上限。
- 买家端套餐卡片展示 RPM/TPM。
- 用户下单创建 `RentalLimit` 时写入：
  - `rpmLimit = ProductPrice.rpmLimit`
  - `tpmLimit = ProductPrice.tpmLimit`

## 运行边界

- RPM/TPM 由本系统 OpenAI/Codex `/v1/*` 本地反代闸门执行。
- `GET/HEAD /v1/models` 和模型详情等元数据请求仍不计入 RPM/TPM，便于用户排查配置。
- 当前 Sub2API Key 创建契约中没有已确认的 RPM/TPM 字段，因此本次不向 Sub2API 伪造上游限速参数。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 Prisma generate | 通过 |
| 本地 Prisma validate | 通过 |
| 本地 API typecheck | 通过 |
| 本地 Admin typecheck | 通过 |
| 本地 Web typecheck | 通过 |
| 本地 API build | 通过 |
| 本地 Admin build | 通过 |
| 本地 Web build | 通过 |

## 当前结论

管理员现在可以在售卖套餐层直接定义 OpenAI/Codex 反代的 RPM/TPM 权益，用户购买后会自动沉淀为租赁限额，并由本地反代闸门执行。这补齐了“商品配置 -> 售出交付 -> 反代限流”的管理闭环。
