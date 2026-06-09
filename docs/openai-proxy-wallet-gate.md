# OpenAI/Codex 反代余额闸门补充

实现日期：2026-06-09

## 背景

当前系统已经通过本地 `/v1/*` OpenAI 兼容入口将售出的本地 API Key 转发到 Sub2API，并由 Sub2 usage 同步任务完成后置计费、钱包扣款和供应商结算。

该模式仍存在一个同步延迟窗口：当用户钱包余额已经不足，但 Sub2 usage 尚未同步入账时，用户可能继续用同一 Key 请求上游。为了让“售出 Key、余额、用量、结算”形成更稳的闭环，反代入口需要在转发前做轻量余额预检。

## 新增规则

- `/v1/*` 反代在转发到 Sub2API 前校验用户钱包。
- 若用户钱包不存在，返回 OpenAI 风格错误：
  - HTTP `402`
  - `error.code=insufficient_balance`
- 若用户钱包可用余额小于或等于 `OPENAI_PROXY_MIN_WALLET_BALANCE`，返回同样的 `insufficient_balance`。
- 默认 `OPENAI_PROXY_MIN_WALLET_BALANCE=0`，即余额必须大于 `0` 才允许继续请求。
- 若租赁存在 `RentalLimit.remainingSpend`，并且该值小于或等于 `0`，返回：
  - HTTP `402`
  - `error.code=spend_limit_exhausted`

## 边界说明

该闸门不是精确的请求级预扣费，也不会替代 Sub2 usage 同步后的最终计费。它的目标是降低明显无余额用户继续消耗上游资源的风险。

精确扣费仍由 `syncSub2UsageOnce` 完成：

- 拉取 Sub2 usage。
- 计算 `apiEquivalentCost`、`buyerCharge`、`supplierIncome`。
- 创建 `UsageRecord`。
- 扣减买家钱包。
- 生成供应商结算记录。

## 涉及文件

- `user/apps/api/src/modules/openai-proxy/routes.ts`
- `user/apps/api/src/config/env.ts`
- `user/.env.example`

## 验收方式

本地静态验收：

- `tsc -p apps/api/tsconfig.json --noEmit`
- `npm --prefix apps/api run build`

线上行为验收建议：

1. 创建或选择一个 active Codex/OpenAI 租赁和 active API Key。
2. 将该用户钱包余额调整为 `0`。
3. 请求 `GET /v1/models`。
4. 预期返回 `402`，`error.code=insufficient_balance`。
5. 给用户钱包充值到大于 `OPENAI_PROXY_MIN_WALLET_BALANCE`。
6. 再次请求 `GET /v1/models`。
7. 预期请求继续通过本地代理转发到 Sub2API。

## 当前限制

该补强只能改善本地余额风控。`POST /v1/responses` 的真实生成能力仍取决于 Sub2API 内是否存在 active 且凭据有效的 OpenAI 上游账号；当前已知阻断仍是 `openai_group_has_no_active_accounts`。
