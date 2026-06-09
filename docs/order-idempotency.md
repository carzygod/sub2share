# 订单创建幂等保护

## 背景

`POST /api/orders` 会同时完成商品价格校验、钱包扣款、订单创建、租赁创建和 Sub2 Key 开通。此前接口没有幂等键，如果用户重复点击、客户端超时重试或调用方直接重复请求，可能重复扣减钱包余额、重复创建租赁并重复开通 Sub2 Key。

## 数据模型

`Order` 新增字段：

```text
idempotencyKey String?
```

新增唯一约束：

```text
@@unique([userId, idempotencyKey])
```

迁移文件：

```text
user/prisma/migrations/0004_order_idempotency_key/migration.sql
```

PostgreSQL 允许唯一索引中存在多个 `NULL`，因此未传幂等键的历史行为保持不变；传入幂等键时，同一个用户不能重复创建同一个键对应的订单。

## API 行为

`POST /api/orders` 支持三种传入方式：

```text
Idempotency-Key: order-xxx
X-Idempotency-Key: order-xxx
```

或请求体：

```json
{
  "productId": "...",
  "priceId": "...",
  "idempotencyKey": "order-xxx"
}
```

如果 header 和 body 同时传入且不一致，接口返回 `idempotency_key_conflict`。

重复请求命中既有订单时：

- 不再次扣款。
- 不再次创建订单、租赁或 Sub2 Key。
- 返回既有订单和租赁。
- 响应头包含 `Idempotency-Replayed: true`。
- `apiKey` 返回 `null`，因为 API Key 明文只允许首个成功响应展示一次。

如果同一个幂等键用于不同商品或价格，接口返回 `idempotency_key_conflict`。

## 前端接入

用户侧购买请求会生成随机幂等键，并同时写入 `Idempotency-Key` header 和请求体，降低重复提交造成重复扣款的风险。

## 可用性结论

该能力补齐了 `ORDER-001`：创建订单接口具备数据库级幂等保护，重复提交不会重复扣款或重复开通 Sub2 资源。
