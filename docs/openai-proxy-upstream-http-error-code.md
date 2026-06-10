# OpenAI/Codex 反代上游 HTTP 错误码归一

实现日期：2026-06-11

## 背景

本地 `/v1/*` 反代已经会记录 `statusCode` 和 `upstreamStatusCode`，但当 Sub2API/OpenAI 上游正常返回 HTTP `4xx` 或 `5xx` 时，`ProxyRequestLog.errorCode` 为空。管理员虽然能看到状态码，却不能通过“反代请求”的错误码筛选快速聚合这类上游错误。

## 已实现范围

- 新增 helper `upstreamHttpProxyErrorCode()`。
- 当上游响应状态码 `>=400` 时，反代日志写入：
  - `upstream_http_400`
  - `upstream_http_401`
  - `upstream_http_429`
  - `upstream_http_500`
  - 以及其他对应 HTTP 状态码。
- 上游 `2xx` 和 `3xx` 不写入错误码。
- 不读取、缓存或改写上游响应体。
- 响应体和响应头仍按原路径透传给客户端。
- 流式响应异常、客户端断开或空闲超时仍会在流结束阶段把 `errorCode` 更新为对应的流式错误码。
- 新增 Node test 覆盖 `upstreamHttpProxyErrorCode()` 的状态码边界。

## 管理员入口

管理员可以在 `反代请求` 页面：

- 通过状态码看到客户端最终 HTTP 结果。
- 通过上游状态码判断 Sub2API/OpenAI 返回值。
- 通过错误码筛选 `upstream_http_500`、`upstream_http_429` 等上游 HTTP 错误。
- 从 `可用性巡检` 的 `反代请求` 问题样本中看到更具体的问题类型，并一键打开请求日志。

## 可用性结论

该能力不改变用户侧响应，只增强本地可观测性。管理员可以更快区分本地准入错误、上游 HTTP 错误、上游不可达和流式链路异常，进一步补齐 OpenAI/Codex 反代排障闭环。
