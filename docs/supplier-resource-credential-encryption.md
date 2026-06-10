# 共享资源凭据加密保存

实现日期：2026-06-10

## 背景

共享资源需要登记上游账号或接入方式。此前 `SupplierResource` 只能记录 `sub2AccountId`，无法安全保存 OpenAI refresh token、API Key 或其他接入凭据。管理员如果需要维护供给资源凭据，只能依赖外部记录或直接改库，既不利于审计，也不满足“敏感凭据必须加密保存”的生产要求。

## 已实现范围

- 新增 Prisma 模型 `SupplierResourceCredential`。
- 新增迁移 `user/prisma/migrations/0013_supplier_resource_credentials/migration.sql`。
- 新增后端加密 helper：
  - `encryptSupplierResourceCredential()`
  - `decryptSupplierResourceCredential()`
  - `credentialFingerprint()`
- 使用 `aes-256-gcm:v1` 加密格式保存凭据密文。
- 加密密钥来自 `API_KEY_ENCRYPTION_SECRET`；生产缺失时系统巡检标记 error。
- 管理员接口：
  - `PUT /api/admin/resources/:id/credential`
  - `DELETE /api/admin/resources/:id/credential`
- 后台资源列表、资源详情和 CSV 导出只展示凭据摘要：
  - 类型
  - 状态
  - 指纹
  - 加密版本
  - 轮换时间
- 审计日志只记录凭据摘要，不记录明文或密文。
- 新增自动化测试覆盖加密、解密、错误密钥拒绝和指纹稳定性。

## 管理员价值

- 管理员可以在共享资源详情中登记、轮换或删除资源接入凭据。
- 后台可以判断某个共享资源是否已经登记凭据，而不会泄露凭据明文。
- 凭据变更会进入审计日志，便于追踪资源接入方式的维护记录。

## 边界

- 当前能力负责安全保存和管理凭据，不会自动把凭据应用到 Sub2API 上游账号。
- 已保存凭据不会通过任何后台响应回显明文。
- 若需要读取密文用于自动上游开通或刷新，应在专门任务中解密，并确保日志、错误和响应继续脱敏。
