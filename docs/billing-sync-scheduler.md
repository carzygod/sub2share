# Sub2 用量定时自动同步

## 背景

Sub2 usage 同步已经具备 cursor 和批次持久化，但如果只依赖管理员手动点击同步，买家余额、租赁额度、售出收入和供应商结算仍可能滞后。生产环境需要服务进程在后台按固定间隔自动拉取 Sub2 usage，并继续复用持久化 cursor，保证同步连续性。

## 配置项

新增 API 服务环境变量：

```text
SUB2_USAGE_SYNC_INTERVAL_MS=60000
SUB2_USAGE_SYNC_ON_START=true
```

- `SUB2_USAGE_SYNC_INTERVAL_MS`：定时同步间隔，单位毫秒；设置为 `0` 时禁用自动同步。
- `SUB2_USAGE_SYNC_ON_START`：服务启动后是否立即执行一次同步。

布尔配置支持 `true/false`、`1/0`、`yes/no`、`on/off`，避免字符串 `"false"` 被错误解析为真值。

## 调度行为

新增后端任务：

```text
user/apps/api/src/jobs/sub2-usage-scheduler.ts
```

服务启动时会根据配置初始化调度器：

1. 间隔为 `0` 时仅记录禁用日志，不启动定时器。
2. 启用后按 `SUB2_USAGE_SYNC_INTERVAL_MS` 周期执行。
3. `SUB2_USAGE_SYNC_ON_START=true` 时启动后立即执行一次。
4. 每次执行都调用 `syncSub2UsageOnce(undefined, { persistCursor: true })`。
5. 如果上一轮同步仍在运行，下一轮会跳过，避免并发同步同一 cursor。
6. 服务关闭时清理定时器。

## 运营影响

自动同步会持续推进 `BillingSyncState.cursor`，并在 `BillingSyncRun` 中留下每次同步批次。管理员仍可通过后台手动触发同步、查看最近状态和失败原因。

该能力补齐了 `BILLING-003`：生产环境不再只能依赖手动同步，usage 入账、余额扣费和售出结算可以在服务内自动推进。
