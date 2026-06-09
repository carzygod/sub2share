# API 存活与就绪探针

实现日期：2026-06-10

## 背景

平台已经提供 `/health`，用于检查业务 API 与数据库的基础可用性。为了让线上部署、反向代理、系统服务和监控工具更清楚地区分“进程存活”和“依赖就绪”，本次新增公开探针 `/live` 与 `/ready`。

## 新增端点

### `GET /live`

用于 liveness probe。

特点：

- 不访问数据库。
- 不访问 Sub2API。
- 只证明 API 进程仍能处理 HTTP 请求。
- 正常返回 HTTP 200。

返回示例：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "service": "zhisuan-yizhan-api",
    "checkedAt": "2026-06-10T00:00:00.000Z"
  }
}
```

### `GET /ready`

用于 readiness probe。

检查内容：

- PostgreSQL 数据库：执行 `SELECT 1`。
- Sub2API 网关：请求 `${SUB2_BASE_URL}/health`，超时时间 5 秒。

状态规则：

- 数据库和 Sub2API 都正常时返回 HTTP 200，`ok = true`。
- 任一依赖异常时返回 HTTP 503，`ok = false`。
- 返回体会包含每个依赖的状态、HTTP 状态码或错误摘要。

## 与既有 `/health` 的关系

- `/health` 保持兼容，继续检查数据库并返回 `zhisuan-yizhan-api`。
- `/live` 推荐用于进程存活探针。
- `/ready` 推荐用于网关、负载均衡和部署平台的就绪探针。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| 本地 API typecheck | 通过 |
| 本地 API build | 通过 |
