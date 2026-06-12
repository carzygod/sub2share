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

- `/v1/*` 反代写日志时，会从 JSON 请求体顶层或 multipart/form-data 的 `model` part 提取模型名。
- 提取规则：
  - 支持 Buffer、Uint8Array 和对象形式请求体。
  - 只读取顶层 `model` 字符串。
  - multipart 请求只读取 `Content-Disposition` 中 `name="model"` 或 `name=model` 的字段值。
  - 空字符串、缺失字段、无效 JSON、非对象 JSON 或缺少 model part 记录为空。
  - 最长保留 160 个字符。
- 不保存请求体和响应体。
- 管理员 `GET /api/admin/proxy-requests` 搜索支持按模型名匹配。
- Admin 订单详情、租赁详情和全局 `反代请求` 列表展示模型。
- `反代请求` CSV 导出新增 `model` 列。
- `可用性巡检` 的反代请求异常样本携带模型，并在对象摘要和说明中展示。
- 新增自动化测试覆盖模型提取边界。

## 管理员价值

- 管理员可以按模型定位某一类上游失败，例如只筛选某个 Codex 模型的 `upstream_http_500`。
- 售后排查时，订单详情和租赁详情能直接显示用户最近请求的模型。
- 导出 CSV 后可以按模型聚合错误率、请求体积和估算 token。

## 安全边界

- 只保存模型名，不保存 prompt、input、messages、tool 调用参数或响应内容。
- 模型字段来自客户端请求体，仅作为排障线索；最终账务仍以 Sub2 usage 同步记录为准。

## 2026-06-12 相关扩展

- `ProxyRequestLog` 新增 `upstreamRequestId`，用于保存 Sub2API/OpenAI 响应头中的上游 request id。
- 管理员 `反代请求` 列表、CSV 和系统健康异常样本会展示该字段。
- 详细说明见 `docs/proxy-request-upstream-request-id.md`。
- Codex/Responses 兼容性继续补强：multipart 请求的 `model` part 现在也会进入 `ProxyRequestLog.model`，便于管理员按模型筛选上传类或混合输入类请求。

## 2026-06-12 扩展：非 JSON URL 模型提取

- `ProxyRequestLog.model` 继续扩展模型名提取来源。
- 当请求 `Content-Type` 明确为 `application/x-www-form-urlencoded` 时，会从表单字段 `model` 提取模型名。
- 当请求 URL 携带 `?model=...` 时，会从 query 参数提取模型名。
- 当请求路径是 `/v1/models/:model` 时，会从路径段提取模型名，用于模型元数据请求排障。
- `text/plain` 等非表单请求体不会被当作 form-urlencoded 解析，避免把 prompt 中的 `model=` 误判为模型名。
- 模型名仍统一 trim 并截断到 160 字符，不保存 prompt、input、messages、文件内容或响应体。
