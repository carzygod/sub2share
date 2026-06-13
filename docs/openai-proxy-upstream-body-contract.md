# OpenAI/Codex 上游 Body 透传契约

## 背景

本地 OpenAI/Codex 反代通过 `/v1` 与 `/v1/*` 统一接入售出的 Key，并转发到 Sub2API。路径、query 和 header 契约已经有独立 helper 与健康检查证据；但 body 转发此前主要由路由内部私有函数承担，系统健康只展示 `requestBodyMode=raw-buffer` 这类静态指标。

完整 OpenAI v1 反代必须可靠处理 JSON、SSE 请求参数、multipart 文件上传、音频、图片、视频、uploads parts 等二进制或半结构化 payload。若代理在转发前重新解析或错误序列化 body，会导致 Sub2API/OpenAI 上游收到的内容和客户端原始请求不一致。

## 新契约

新增 `openAiProxyUpstreamBody(method, body)` 作为可测试的上游 body 构造 helper：

- `GET`、`HEAD` 请求始终不携带 body。
- `string` body 原样转发。
- `Buffer` 与 `Uint8Array` 转为 `Blob`，保持原始字节。
- `ArrayBuffer` 转为 `Blob`，保持原始字节。
- 已经是 `Blob` 的 body 直接转发。
- 普通对象按 JSON 字符串转发，用于非 raw parser 场景下的兼容兜底。

`registerOpenAiProxyRoutes()` 现在直接使用该 helper，避免路由私有实现与契约检查漂移。

## 健康证据

`inspectOpenAiProxyContract()` 新增 body 实测指标：

- `forwardsRawBinaryBodyAsBlob`
- `dropsBodylessMethodBodies`
- `forwardsTextAndJsonBodies`

如果任一实测失败，巡检会返回 `upstream_body_forwarding_incomplete`，说明本地代理已经不满足完整 OpenAI/Codex 反代的 body 转发要求。

Dashboard 健康 preview 白名单同步保留这些指标，管理员可以在首页或完整巡检中看到 body 透传证据，而不是只看到静态 `requestBodyMode`。

## 验证

- `pnpm.cmd --filter @zyz/api typecheck`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/openai-proxy-helpers.test.ts`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-capabilities.test.ts`

该能力不触发真实 OpenAI 请求，不解密凭据，不改变余额、限流、扣费、租赁或 Sub2API 账号状态；它只把本地反代内核的 body 转发行为变成可测试、可巡检的契约。

## 2026-06-13 生产发布复查

- Commit：`447d83555e04ea0b5ae611ce8901319ddd7fd0d0`
- Release marker：`deployed_at=20260613T042758Z`
- Systemd 服务：`zyz-api`、`zyz-admin`、`zyz-web`、`sub2api` 均为 `active`。
- 发布脚本内验证：
  - API typecheck：通过。
  - Admin typecheck：通过。
  - API tests：148/148 通过。
  - Admin tests：17/17 通过。
  - Workspace build：通过。
  - `/health`、`/ready`、Web、Admin 探针均返回 200。
- 线上系统健康复查：
  - `openAiProxyContract.status=ok`
  - `openAiProxyContract.metrics.requestBodyMode=raw-buffer`
  - `openAiProxyContract.metrics.forwardsRawBinaryBodyAsBlob=true`
  - `openAiProxyContract.metrics.dropsBodylessMethodBodies=true`
  - `openAiProxyContract.metrics.forwardsTextAndJsonBodies=true`
  - Dashboard `latestSystemHealth.criticalChecks` 同步保留这三个 body 实测指标。
- 实时系统健康仍为 `24 ok / 2 warning / 3 error`。剩余阻断仍是有效 OpenAI refresh token、active Sub2 OpenAI 账号和 online Codex 共享资源缺失；本次变更只证明本地反代 body 转发契约正常。
