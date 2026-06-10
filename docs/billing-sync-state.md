# Sub2 用量同步状态持久化

## 背景

用量同步直接影响买家余额、租赁额度、售出收入和供应商结算。此前同步接口只返回 `nextCursor`，但不保存同步 cursor、批次、开始/结束时间或失败信息。服务重启后，管理员只能手动传入 cursor，无法从后台判断同步是否连续、最近一次是否失败。

## 数据模型

新增 Prisma 模型：

```text
BillingSyncState
BillingSyncRun
```

迁移文件：

```text
user/prisma/migrations/0003_billing_sync_state/migration.sql
```

`BillingSyncState` 保存 Sub2 usage 同步的当前 cursor 和最近状态。

`BillingSyncRun` 保存每次同步批次：

- `cursorIn`
- `cursorOut`
- `status`
- `imported`
- `skipped`
- `unmatched`
- `error`
- `startedAt`
- `finishedAt`

## 同步行为

`syncSub2UsageOnce(cursor, { persistCursor: true })` 会：

1. 读取保存的 cursor。
2. 如果请求显式传入 cursor，则优先使用传入值。
3. 创建 `running` 批次。
4. 调用 Sub2API 拉取 usage。
5. 入账成功后更新批次为 `success`。
6. 保存 `nextCursor` 到 `BillingSyncState.cursor`。
7. 失败时更新批次和状态为 `failed`，保存脱敏错误。

重复 Sub2 usage 仍由 `UsageRecord.sub2RequestId` 唯一索引和事务内已存在检查保证幂等。

如果重复记录对应的本地 usage 仍为 `pending` 且 `buyerCharge > 0`，同步任务会把它作为待恢复账务重新尝试扣费。恢复成功时返回值会包含 `recovered` 计数；由于 `BillingSyncRun` 仍沿用原有 `imported/skipped/unmatched` 三列，持久化的 `imported` 包含已恢复入账的 pending usage。

## 管理员入口

新增接口：

```text
GET /api/admin/usages/sync-state
```

手动同步接口：

```text
POST /api/admin/usages/sync-sub2
```

现在默认启用 cursor 持久化。

后台“用量”页面新增同步状态面板，展示：

- 当前 cursor
- 最近状态
- 最近开始/完成时间
- 最近导入/跳过/未匹配数量
- 手动同步完成提示中的 pending usage 恢复数量
- 最近错误
- 最近 5 个同步批次

## 可用性结论

该能力补齐了 `BILLING-002`：用量同步现在具备 cursor、批次、时间和错误的持久化记录，管理员可以在后台直接判断同步是否连续、是否失败以及失败原因。
