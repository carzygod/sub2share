# 系统巡检 Sub2 绑定问题直达
实现日期：2026-06-12

## 背景

`Sub2Binding` 是本地租赁、API Key 与 Sub2API 对象之间的归因映射。该映射异常会影响 usage 同步、反代请求排障和历史 Key 轮换追踪。此前 `GET /api/admin/system-health` 已经计算 `sub2Bindings` 巡检状态和汇总指标，但没有把具体 issue 放进 `detail.issues`，管理员在可用性巡检页只能看到 warning 数字，仍需手动进入 `反代状态` 页面重新巡检并复制租赁 ID。

## 新增能力

- `sub2Bindings` 系统巡检项在存在绑定问题时返回 `detail.issues`。
- issue 保留原有字段：
  - `id`
  - `type`
  - `severity`
  - `rentalId`
  - `bindingId`
  - `sub2Type`
  - `expected`
  - `actual`
  - `message`
- 管理员前端 `可用性巡检` 页面会复用已有问题样本解析逻辑：
  - `rentalId` 自动生成 `打开租赁` 操作。
  - `bindingId`、`expected`、`actual` 会出现在定位对象文本中。
- 新增 `sub2BindingHealthCheck()` 纯函数，避免后续重构时遗漏 issue detail。
- 新增单元测试覆盖：当存在 Sub2 绑定问题时，健康检查结果必须携带 `detail.issues`。

## 管理价值

- 管理员可以从统一可用性巡检页直接进入受影响租赁，减少在 `反代状态`、租赁列表和数据库对象之间手动复制 ID。
- Sub2 usage 归因异常、current api_key 绑定缺失、绑定不一致、孤儿绑定等问题更容易形成巡检到修复的闭环。
- 该能力不改变 `repairSub2Bindings` 的边界：只暴露证据和跳转入口，不自动调用修复接口，不修改余额、订单、租赁或 Sub2 上游 Key。

## 验证

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-sub2-binding-health.test.ts tests/admin-capabilities.test.ts`
