# OpenAI 反代本地并发闸门

实现日期：2026-06-09

## 背景

产品价格和租赁限制中已经有 `maxConcurrency`，下单时也会把并发能力传给 Sub2 Key。为了让本系统的 OpenAI/Codex 反代入口也具备即时保护，需要在转发到 Sub2API 之前先按租赁做本地并发校验。

## 已实现范围

- `/v1/*` 反代入口新增进程内并发租约。
- 并发上限来自 `RentalLimit.maxConcurrency`，缺省按 `1` 处理。
- 每个通过校验的请求会占用一个租赁级并发租约。
- 响应完成或客户端连接关闭时自动释放租约。
- `GET /api/admin/system-health` 的 `openAiProxyRuntime` 检查会暴露当前进程活跃并发租赁数和并发租约数。
- 超过并发上限时返回 OpenAI 风格错误：

```json
{
  "error": {
    "message": "Rental concurrency limit has been reached",
    "type": "rate_limit_error",
    "code": "concurrency_limit_exceeded"
  }
}
```

- 代理日志新增 `activeProxyRequests` 和 `proxyConcurrencyLimit`，方便排查租赁是否达到并发上限。

## 边界

当前闸门是单 API 进程内的实时保护，适合当前单实例部署。若后续 API 多实例横向扩容，需要把并发计数迁移到 Redis、Sub2API 网关或其他共享限流器中，避免不同实例各自计数。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 API build | 通过 |
