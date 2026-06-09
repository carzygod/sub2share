# 管理员共享资源配置维护

实现日期：2026-06-10

## 背景

共享资源此前支持创建、查看详情、测试可用性和快速上下线，但创建后的核心配置缺少统一维护入口。管理员需要能在资源池运营过程中调整并发、分成、保留比例、日上限和绑定的 Sub2 账号，才能处理供给方升级、成本变化、异常限流和账号替换等日常场景。

## 后端接口

- 新增接口：`PATCH /api/admin/resources/:id`
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

## 管理员入口

管理后台 `共享资源` 页面增强：

- 列表展示分成、保留比例和日上限。
- 详情面板新增配置调整表单。
- 管理员可直接保存状态、等级、并发、分成、保留比例、日上限和 Sub2 账号。
- 保存后刷新资源列表和当前详情面板。
- 共享资源 CSV 导出新增分成、保留比例、日上限、最后检查时间字段。

## 权限边界

- `operator` 仍可查看资源、测试资源、执行快速状态调整。
- `admin` 才能修改分成、保留比例、日上限、并发和 Sub2 账号等资源配置。
- 资源类型暂不允许在创建后修改，避免历史用量、商品和调度归属被改写。

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
