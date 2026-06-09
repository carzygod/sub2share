# OpenAI/Codex 反代请求量即时台账

实现日期：2026-06-10

## 背景

`RentalLimit.requestLimit` 原先只依赖已经同步到本地的 `UsageRecord` 数量进行拦截。该策略可以覆盖账单同步后的二次风控，但在 Sub2 usage 尚未同步到本地之前，用户仍可能继续通过 `/v1/*` 反代入口发起请求，形成短暂超额窗口。

本次改造将本地 `ProxyRequestLog` 纳入准入判断，让反代入口在转发前即可依据本地已转发台账执行请求量限制。

## 新规则

非元数据 OpenAI/Codex 请求在转发到 Sub2API 前会读取：

- `UsageRecord` 中同一租赁的已同步用量数量。
- `ProxyRequestLog` 中同一租赁已经实际转发到上游的请求数量。

系统以两者的较大值作为 `requestUsed`：

```text
requestUsed = max(usageRecordCount, proxyRequestCount)
```

当 `requestUsed >= RentalLimit.requestLimit` 时，请求会被本地反代入口拦截，并返回 OpenAI 风格错误：

```json
{
  "error": {
    "message": "Rental request limit has been exhausted",
    "type": "request_limit_exceeded",
    "code": "request_limit_exceeded"
  }
}
```

HTTP 状态码为 `429`。

## 计数范围

本地请求台账只统计已经实际转发到 Sub2API 的请求：

- `ProxyRequestLog.rentalId` 等于当前租赁。
- `ProxyRequestLog.upstreamStatusCode` 不为空。
- 排除模型元数据请求：
  - `GET /v1/models`
  - `HEAD /v1/models`
  - `GET /v1/models/:id`
  - `HEAD /v1/models/:id`

使用 `max(usageRecordCount, proxyRequestCount)` 而不是相加，是为了避免 Sub2 usage 同步完成后与本地 proxy log 对同一批真实请求重复计数。

## 可观测性

成功转发时，服务端请求日志会额外记录：

- `proxyRequestLimit`
- `proxyRequestUsed`
- `proxyUsageRecordCount`
- `proxyLedgerRequestCount`

管理员仍可通过 `反代请求` 页面查看逐条 `ProxyRequestLog`，通过 `可用性巡检` 查看反代链路近期健康状态。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/api run build`

线上验证建议：

1. 创建一个 `requestLimit=1` 的 Codex/OpenAI 租赁。
2. 使用售出的本地 Key 调用一次非元数据 `/v1/*` 请求，例如 `/v1/responses`。
3. 在 Sub2 usage 尚未同步前，立刻再次调用非元数据 `/v1/*` 请求。
4. 预期第二次请求返回 `429 request_limit_exceeded`。
5. 调用 `GET /v1/models`，预期仍允许转发，方便用户排查模型可见性和 Key 配置。

## 当前边界

该能力依赖本地 `ProxyRequestLog` 成功写入。日志写入失败时，为避免日志数据库短暂异常拖垮用户请求，系统仍只记录服务端 warning，不阻断转发。因此线上仍应配合数据库可用性监控、`/ready` 探针和管理员可用性巡检一起使用。
