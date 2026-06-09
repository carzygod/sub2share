# OpenAI/Codex 反代测试覆盖

实现日期：2026-06-10

## 背景

本地 `/v1/*` 反代承担售出 Key 的准入、余额、租赁、请求量、速率、并发和 Sub2API 透传。此前 API 包的 `test` 脚本只是占位，无法在改动代理规则后及时发现 `/v1/models` 元数据请求误计入套餐限制、`/v1/responses` 误被当成元数据请求、或请求体估算变化导致 TPM 闸门异常。

## 已实现能力

- 新增 `user/apps/api/src/modules/openai-proxy/helpers.ts`。
- 将反代元数据路径识别、请求体文本化、请求字节数统计和输入 token 粗估抽为纯 helper。
- `user/apps/api/package.json` 的 `test` 脚本改为真实执行 Node test runner。
- 新增 `user/apps/api/tests/openai-proxy-helpers.test.ts`。
- 测试覆盖：
  - `GET /v1/models`
  - `HEAD /v1/models?limit=20`
  - `GET /v1/models/:id`
  - 非元数据请求 `POST /v1/responses`、`POST /v1/chat/completions`
  - Buffer、字符串、JSON 对象请求体的 token 粗估和字节统计

## 验收命令

```bash
npm --prefix user/apps/api test
npm --prefix user/apps/api run typecheck
npm --prefix user/apps/api run build
```

## 管理员价值

- 降低反代门禁规则后续改动时的回归风险。
- 确保模型列表等诊断型请求继续不消耗套餐请求数、RPM 和 TPM。
- 确保 Responses、Chat Completions 等真实生成请求继续进入本地风控和可观测链路。
