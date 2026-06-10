# OpenAI 反代本地并发闸门

实现日期：2026-06-09

## 背景

产品价格和租赁限制中已经有 `maxConcurrency`，下单时也会把并发能力传给 Sub2 Key。为了让本系统的 OpenAI/Codex 反代入口也具备即时保护，需要在转发到 Sub2API 之前先按租赁做本地并发校验。

## 已实现范围

- `/v1/*` 反代入口新增租赁级并发租约。
- 新增 `OPENAI_PROXY_LIMITER_STORE` 后，生产环境默认使用 Redis 共享并发租约，非生产环境默认使用进程内存。
- 并发上限来自 `RentalLimit.maxConcurrency`，缺省按 `1` 处理。
- 每个通过校验的请求会占用一个租赁级并发租约。
- 响应完成或客户端连接关闭时自动释放租约。
- Redis 并发租约带 TTL 与周期续租，API 进程异常退出后会自动收敛。
- `GET /api/admin/system-health` 的 `openAiProxyRuntime` 检查会暴露当前 limiter store、共享状态、活跃并发租赁数和并发租约数。
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

生产环境默认 Redis 共享并发计数，适合 API 多实例部署。显式配置 `OPENAI_PROXY_LIMITER_STORE=memory` 时，闸门仍是单 API 进程内实时保护，只适合本地开发、测试或明确的单实例部署。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 API build | 通过 |
