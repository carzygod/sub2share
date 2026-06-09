# OpenAI/Codex 反代本地限额闸门

实现日期：2026-06-09

## 背景

产品价格和租赁模型中已经存在 `requestLimit`、`spendLimit`、`remainingSpend` 等字段，但反代入口此前只校验 Key、用户、租赁状态、余额和 Sub2 绑定。若 Sub2 usage 已经同步到本地，系统仍需要能用本地数据做二次风控，避免套餐限制只停留在展示层。

## 新增规则

### 请求数软限制

`/v1/*` 反代入口在转发到 Sub2API 前，会读取租赁 `RentalLimit.requestLimit`。

- 若未设置 `requestLimit`，不拦截。
- 若当前请求是模型元数据请求，不拦截：
  - `GET /v1/models`
  - `HEAD /v1/models`
  - `GET /v1/models/:id`
  - `HEAD /v1/models/:id`
- 其他 OpenAI/Codex 请求会统计该租赁已同步的 `UsageRecord` 数量。
- 统计范围：`pending`、`billed`、`disputed`。
- 当已同步用量数大于等于 `requestLimit` 时，返回 OpenAI 风格错误：
  - HTTP `429`
  - `error.code=request_limit_exceeded`

该规则是基于已同步 usage 的软限制，不能替代 Sub2API 内部实时限流，但能给本系统增加可解释、可审计的兜底防线。

### 剩余额度维护

Sub2 usage 同步入账时会维护 `RentalLimit.remainingSpend`：

- 若设置了 `spendLimit` 或已有 `remainingSpend`，每条新 usage 会按 `buyerCharge` 扣减 `remainingSpend`。
- `remainingSpend` 最低归零，不写入负数。
- 若 `remainingSpend` 用尽，租赁会被标记为 `limited`。
- 若 `requestLimit` 因本次 usage 达到上限，租赁也会被标记为 `limited`。
- 若同时发生钱包不足，租赁优先标记为 `low_balance`。

## 涉及文件

- `user/apps/api/src/modules/openai-proxy/routes.ts`
- `user/apps/api/src/jobs/sync-sub2-usage.ts`

## 验收方式

本地验证：

- `tsc -p apps/api/tsconfig.json --noEmit`
- `npm --prefix apps/api run build`

线上验收建议：

1. 创建一个 `requestLimit=1` 的 Codex/OpenAI 套餐。
2. 用售出 Key 完成一次能产生 Sub2 usage 的 `/v1/responses` 请求。
3. 触发 Sub2 usage 同步。
4. 再次请求非元数据 `/v1/*` 路径，预期返回 `429 request_limit_exceeded`。
5. 请求 `GET /v1/models`，预期仍允许转发，便于用户查看可用模型和排查配置。

## 当前限制

该能力依赖 Sub2 usage 已同步到本地。同步延迟窗口内，实时请求数限制仍应由 Sub2API 或上游网关承担。
