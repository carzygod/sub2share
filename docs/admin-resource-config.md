# 管理员共享资源配置维护

实现日期：2026-06-10

## 背景

共享资源此前支持创建、查看详情、测试可用性和快速上下线，但创建后的核心配置缺少统一维护入口。管理员需要能在资源池运营过程中调整并发、分成、保留比例、日上限、绑定的 Sub2 账号和接入凭据，才能处理供给方升级、成本变化、异常限流和账号替换等日常场景。

## 后端接口

- 新增接口：`PATCH /api/admin/resources/:id`
- 新增接口：`PUT /api/admin/resources/:id/credential`
- 新增接口：`DELETE /api/admin/resources/:id/credential`
- 新增接口：`POST /api/admin/resources/:id/apply-credential-to-sub2`
- 权限要求：`admin`
- 可更新字段：
  - `status`
  - `level`
  - `maxConcurrency`
  - `shareRate`
  - `reserveRatio`
  - `dailyCap`
  - `sub2AccountId`
- `dailyCap` 和 `sub2AccountId` 支持传入 `null` 清空。
- 当 `sub2AccountId` 发生配置更新时，系统会清空 `lastCheckedAt`，避免旧账号测试结果误导管理员。
- 更新动作写入审计日志：`admin.resource.update`。
- 凭据写入动作使用 `API_KEY_ENCRYPTION_SECRET` 加密保存，只返回类型、状态、指纹和轮换时间。
- `POST /api/admin/resources` 支持在创建共享资源时同步传入可选初始凭据字段：`credentialType`、`credentialStatus`、`credentialSecret`；只有填写 `credentialSecret` 时才会创建加密凭据。
- 创建共享资源时可显式传入 `applyCredentialToSub2=true`，系统会在创建成功后把初始 `openai_refresh_token` 应用到绑定的 Sub2 账号；可选字段包括 `credentialClientId`、`credentialProxyId`、`credentialRunSmokeTest` 和 `credentialSmokeModel`。
- 凭据写入和删除分别记录审计日志：`admin.resource.credential_upsert`、`admin.resource.credential_delete`。
- 凭据应用动作会读取资源绑定的 `sub2AccountId`，仅支持 active 的 `openai_refresh_token`，并记录审计日志 `admin.resource.credential_apply_sub2`。
- 凭据应用成功后会立即测试 Sub2 账号，并更新共享资源的 `status` 与 `lastCheckedAt`。
- 凭据应用请求可传入 `runSmokeTest=true` 和可选 `smokeModel`；只有凭据应用成功且 Sub2 账号测试通过时，才会继续执行本地 OpenAI/Codex 反代端到端自检。

## 管理员入口

管理后台 `共享资源` 页面增强：

- 列表展示分成、保留比例和日上限。
- 详情面板新增配置调整表单。
- 管理员可直接保存状态、等级、并发、分成、保留比例、日上限和 Sub2 账号。
- 管理员创建共享资源时可同步保存初始接入凭据；也可勾选“创建后应用到 Sub2”，同次触发 Sub2 凭据应用、账号测试和可选端到端自检。
- 管理员可在资源详情中登记、轮换或删除接入凭据。
- 管理员可把资源中已加密保存的 OpenAI refresh token 应用到绑定的 Sub2 上游账号，并看到应用后的账号测试结果；需要完整恢复证据时，可勾选“应用后端到端自检”，同次验证本地 `/v1/models` 与 `/v1/responses`。
- 从 `可用性巡检` 中资源凭据或共享资源问题点击 `打开共享资源` 时，创建共享资源表单会预填巡检关联的供给方邮箱、资源类型和 Sub2 账号 ID；如果共享资源缺失问题没有具体资源行，后端会继承 Sub2/OpenAI 上游巡检的首个修复候选账号，并在系统只有一个 active 用户关联供给方时继承该供给方邮箱；普通进入或清空筛选时恢复默认创建表单。
- 保存后刷新资源列表和当前详情面板。
- 共享资源 CSV 导出新增分成、保留比例、日上限、凭据类型、凭据状态、凭据指纹和最后检查时间字段。

## 权限边界

- `operator` 仍可查看资源、测试资源、执行快速状态调整。
- `admin` 才能修改分成、保留比例、日上限、并发和 Sub2 账号等资源配置。
- `admin` 才能写入、轮换或删除共享资源接入凭据。
- `admin` 才能把共享资源凭据应用到 Sub2 上游账号。
- 资源类型暂不允许在创建后修改，避免历史用量、商品和调度归属被改写。
- 后台列表、详情、导出和审计日志都不回显凭据明文或密文。
- 凭据应用结果只返回 `ok/refreshed/applied/error`、账号测试结果、可选端到端自检摘要和资源摘要，不返回 refresh token 或 OAuth credentials。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/admin run typecheck`
- `npm --prefix user/apps/admin run build`

功能验证建议：

1. 使用管理员账号进入 `共享资源`。
2. 打开任一资源详情。
3. 修改并发、分成、保留比例、日上限或 Sub2 账号并保存。
4. 确认详情和列表刷新后展示新值。
5. 查看审计日志中是否出现 `admin.resource.update`。
6. 若清空或更换 Sub2 账号，确认 `lastCheckedAt` 被清空，需要重新执行资源测试。

## 2026-06-12 扩展：资源巡检创建默认值

- 管理员从首页 `resources` 巡检 warning 进入共享资源页时，创建表单会继续沿用巡检上下文：
  - 供应方邮箱。
  - 资源类型。
  - Sub2 账号 ID。
  - `repairAction`。
  - smoke 模型与失败阶段字段。
- 当 `repairAction=apply_openai_refresh_token_to_sub2_account` 且存在 Sub2 账号时，创建表单默认勾选 `创建后应用到 Sub2`。
- 对生产 Codex 资源修复路径，创建表单默认勾选 `应用后端到端自检`。
- 管理员仍可手动取消上述 checkbox；系统不会在没有提交表单时自动写入凭据、应用到 Sub2 或触发 smoke test。
