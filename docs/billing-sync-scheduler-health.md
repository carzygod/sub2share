# 用量同步调度巡检

实现日期：2026-06-10

## 背景

Sub2 usage 同步负责把真实 OpenAI/Codex 反代用量转成本地买家扣费、售出收入和供应商结算。系统已经支持 `SUB2_USAGE_SYNC_INTERVAL_MS` 定时同步，但如果生产环境没有启用调度，账务入账就会退化为管理员手动点击同步，容易造成余额、售出和结算滞后。

## 后端能力

`GET /api/admin/system-health` 新增检查项：

```text
billingSyncScheduler / 用量同步调度
```

检查规则：

- `SUB2_USAGE_SYNC_INTERVAL_MS=0`：
  - 生产环境标记 `error`。
  - 非生产环境标记 `warning`。
- `SUB2_USAGE_SYNC_INTERVAL_MS` 大于 24 小时同步陈旧阈值时标记 `warning`。
- 生产环境启用定时同步但 `SUB2_USAGE_SYNC_ON_START=false` 时标记 `warning`，提示服务启动后要等到首个 interval 才会同步。

返回指标：

- `enabled`
- `intervalMs`
- `onStart`
- `nodeEnv`
- `staleThresholdMs`

## 管理员价值

- 管理员可以在可用性巡检中直接确认 usage 同步是否会自动运行。
- 生产环境禁用自动同步会提升为全局 error，避免账务只靠人工触发。
- 该检查与 `billingSync` 最近状态、`pendingUsageBilling` 积压巡检互补：一个看调度配置，一个看最近执行结果，一个看账务积压。

## 设计边界

- 巡检只读取环境配置，不启动或停止调度器。
- 是否真正执行同步仍由 API 进程启动时的 `startSub2UsageSyncScheduler()` 控制。
