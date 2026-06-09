# 共享资源可用性测试

## 背景

管理员需要判断共享资源是否真的能承载 OpenAI/Codex 反代请求。此前后台可以创建资源、查看资源详情和手动调整资源状态，但缺少资源级测试入口，`POST /api/admin/resources/:id/test` 仍停留在需求文档的 P0 待办项。

## 已实现

新增接口：

```text
POST /api/admin/resources/:id/test
```

权限：

- `operator`
- `admin`

处理流程：

1. 读取本地 `SupplierResource`。
2. 校验该资源已绑定数字型 `sub2AccountId`。
3. 调用 Sub2API 的账号测试能力。
4. 更新资源 `lastCheckedAt`。
5. 根据测试结果自动收敛资源状态。
6. 写入审计日志 `admin.resource.test`。

## 状态收敛规则

测试通过：

- `pending`、`testing`、`abnormal` 会更新为 `online`。
- `online`、`busy` 保持当前状态。
- `paused`、`disabled` 保持当前状态，避免测试动作绕过人工停用。

测试失败：

- `pending`、`testing`、`online`、`busy` 会更新为 `abnormal`。
- `paused`、`disabled` 保持当前状态。

## 后台入口

后台共享资源列表中的“测试”按钮已接入真实测试接口，不再只是把状态改为 `testing`。

测试完成后，后台会刷新共享资源列表；若当前打开了资源详情，也会刷新详情数据。

## 可用性结论

该补强让管理员可以从共享资源池直接验证 Sub2 上游账号是否可用，并把测试结果沉淀到本地资源状态、最后检查时间和审计日志中。它对“共享情况管理”和“Codex 反代可用性复查”是核心运营入口。
