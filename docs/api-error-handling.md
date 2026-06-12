# API 错误响应收敛

实现日期：2026-06-12

## 背景

管理员维修 Sub2/OpenAI 账号时，接口经常由按钮或脚本触发。此前全局错误处理只识别业务 `AppError`，Fastify 框架级 4xx 解析错误和 Zod 参数校验错误会落入兜底分支，返回 `500 internal_error`。这会把客户端输入问题误报成服务端故障，削弱可用性巡检和管理员维修闭环。

## 已实现范围

- `AppError` 继续保留原有 status、code、message 和 details。
- Zod 参数校验错误统一返回：
  - HTTP 400
  - `code=validation_error`
  - 字段路径、校验 code 和校验 message。
- Fastify 框架级 4xx 错误保留原始 HTTP status。
- Fastify 错误 code 会归一为小写下划线格式，例如：
  - `FST_ERR_CTP_EMPTY_JSON_BODY` -> `fst_err_ctp_empty_json_body`
- 未识别或 5xx 错误仍返回脱敏 `500 internal_error`，并写入服务端日志。

## 管理员维修收益

- `POST /api/admin/sub2/accounts/:id/refresh`
- `POST /api/admin/sub2/accounts/:id/test`
- `POST /api/admin/sub2/proxy-smoke-test`

这些无参数维修动作即使被脚本以空 JSON body 误调用，也不会再被误报为内部故障；管理员可以看到准确的 4xx 错误 code。前端按钮仍按正常方式发送 `{}`。

## 验收方式

```bash
pnpm --filter @zyz/api exec node --import tsx --test tests/api-error-handler.test.ts
pnpm --filter @zyz/api typecheck
pnpm --filter @zyz/api test
pnpm --filter @zyz/api build
```
