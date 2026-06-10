# 反代请求日志模型字段

实现日期：2026-06-11

## 背景

`UsageRecord` 已经能从 Sub2 usage 同步中记录真实模型，但管理员排查实时 OpenAI/Codex 反代请求时，只能看到路径、状态码、错误码和本地估算 token，无法直接判断用户请求的是哪个模型。

本次将请求体顶层 `model` 持久化到 `ProxyRequestLog`，用于反代请求排障、售出套餐核查和系统巡检样本定位。

## 已实现范围

- `ProxyRequestLog` 新增字段 `model String?`。
- 新增迁移：

```text
user/prisma/migrations/0014_proxy_request_log_model/migration.sql
```

- `/v1/*` 反代写日志时，会从 JSON 请求体顶层提取 `model`。
- 提取规则：
  - 支持 Buffer、Uint8Array 和对象形式请求体。
  - 只读取顶层 `model` 字符串。
  - 空字符串、缺失字段、无效 JSON 或非对象 JSON 记录为空。
  - 最长保留 160 个字符。
- 不保存请求体和响应体。
- 管理员 `GET /api/admin/proxy-requests` 搜索支持按模型名匹配。
- Admin 订单详情、租赁详情和全局 `反代请求` 列表展示模型。
- `反代请求` CSV 导出新增 `model` 列。
- 新增自动化测试覆盖模型提取边界。

## 管理员价值

- 管理员可以按模型定位某一类上游失败，例如只筛选某个 Codex 模型的 `upstream_http_500`。
- 售后排查时，订单详情和租赁详情能直接显示用户最近请求的模型。
- 导出 CSV 后可以按模型聚合错误率、请求体积和估算 token。

## 安全边界

- 只保存模型名，不保存 prompt、input、messages、tool 调用参数或响应内容。
- 模型字段来自客户端请求体，仅作为排障线索；最终账务仍以 Sub2 usage 同步记录为准。
