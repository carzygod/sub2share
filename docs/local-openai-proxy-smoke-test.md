# OpenAI/Codex 本地反代端到端自检

实现日期：2026-06-10

## 背景

管理员后台已有 `POST /api/admin/sub2/proxy-smoke-test`，但原实现主要验证 Sub2API 网关自身：创建临时 Sub2 Key 后直接请求 Sub2 的 `/v1/models` 和 `/v1/responses`。这可以证明上游账号、分组和 Sub2 网关是否可用，但不能证明本系统自己的 OpenAI/Codex 反代链路完整可用。

本次改造将该自检升级为本地反代端到端烟测：同一个按钮会穿过本地租赁、钱包、API Key 哈希、限额、`/v1/*` 透传、`ProxyRequestLog` 和 Sub2API 上游。

## 自检流程

管理员点击后台 `反代状态 -> 端到端自检` 后，服务端执行：

1. 使用稳定 smoke buyer id 在 Sub2API 创建临时 Codex/OpenAI Key。
2. 在本地创建或复用 smoke 用户：
   - `admin-openai-proxy-smoke@local.invalid`
3. 在本地创建离线 smoke 商品、0 金额订单、active smoke 租赁和 active 本地 API Key。
4. 将 Sub2 临时 Key 的明文只用于本次调用，落库时只保存哈希与前缀。
5. 使用 `OPENAI_PROXY_PUBLIC_ENDPOINT` 或推导出的本地公开 endpoint 请求：
   - `GET /v1/models`
   - `POST /v1/responses`
6. 统计本次 smoke 租赁关联的 `ProxyRequestLog` 数量。
7. 清理临时资源：
   - 本地 API Key 置为 `inactive`
   - 本地租赁置为 `closed`
   - 本地订单置为 `closed`
   - 本地 smoke 钱包余额归零
   - Sub2 临时 Key 置为 `inactive`
8. 写入审计日志 `admin.sub2.proxy_smoke_test`。

## 返回结果

接口仍为：

```text
POST /api/admin/sub2/proxy-smoke-test
```

响应新增 `localProxy` 字段：

- `ok`：本地代理链路是否通过。
- `endpoint`：本次请求使用的本地公开反代 endpoint。
- `rentalId`：本次 smoke 租赁。
- `apiKeyPrefix`：临时本地 Key 前缀。
- `proxyRequestLogCount`：本次 smoke 租赁产生的反代请求日志数量。
- `apiKeyDeactivated`：本地 API Key 是否已停用。
- `rentalClosed`：本地租赁是否已关闭。
- `orderClosed`：本地订单是否已关闭。
- `walletReset`：本地 smoke 钱包余额是否已归零。

后台页面会展示：

- 临时 Sub2 Key 是否禁用。
- `Models` 请求是否通过。
- `Responses` 请求是否通过。
- 本地代理链路是否通过。
- 代理日志数量。
- 本地 smoke 订单、租赁和 Key 是否完成清理。

## 判定标准

整体 `ok=true` 需要同时满足：

- 本地 smoke 开通成功。
- `GET /v1/models` 通过本地反代请求成功。
- `POST /v1/responses` 通过本地反代请求成功，且响应体不包含 OpenAI 风格 error。
- 本次 smoke 租赁至少产生 2 条 `ProxyRequestLog`。
- 本地 API Key 已停用。
- 本地租赁已关闭。
- 本地订单已关闭。
- 本地 smoke 钱包余额已归零，避免污染管理员余额汇总。
- Sub2 临时 Key 已禁用。

## 边界说明

- smoke 商品状态为 `offline`，不会进入正常售卖入口。
- smoke 订单金额为 0，不形成真实销售收入。
- smoke 钱包只在自检过程中临时设置为代理准入所需的最低余额，结束后会归零。
- smoke 租赁会保留 Sub2 `api_key` 绑定，便于后续 Sub2 usage 同步时归因，避免自检 usage 变成 unmatched。
- smoke usage 同步到本地时会写为 `ignored`，不扣余额、不产生供应商结算、不改变 smoke 租赁状态。
- 默认管理员运营统计会排除内部 smoke 用户、订单、租赁、商品、钱包和 usage；详见 `docs/internal-smoke-data-hygiene.md`。
- 自检仍依赖真实 Sub2/OpenAI 上游。如果 Sub2 没有 active OpenAI 账号，`/v1/responses` 仍会失败；这类失败是有效诊断结果，不代表本地代理代码一定异常。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/admin run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/admin run build`

线上验证建议：

1. 确认 `OPENAI_PROXY_PUBLIC_ENDPOINT` 指向当前 API 服务的 `/v1`；如果未配置该变量，则必须配置 `API_PUBLIC_URL`，生产环境不再从前端 `APP_PUBLIC_URL` 推导反代入口。
2. 管理员登录后台，进入 `反代状态`。
3. 点击 `端到端自检`。
4. 确认页面显示：
   - 临时 Key 已禁用。
   - Models 通过。
   - Responses 通过。
   - 本地代理通过。
   - 代理日志数量不少于 2。
   - 本地清理完成。
