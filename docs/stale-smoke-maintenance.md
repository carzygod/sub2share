# Stale Smoke 自检资源清理

实现日期：2026-06-10

## 背景

本地 OpenAI/Codex 端到端自检会临时创建本地 smoke 用户、钱包、订单、租赁、API Key 和 Sub2 Key。正常路径会在自检结束后完成清理，但如果 API 进程重启、请求超时、管理员关闭页面或上游调用长时间卡住，可能留下 active 的内部临时资源。

这些残留不会进入默认运营统计，但如果本地 API Key 或 Sub2 Key 仍保持 active，会带来不必要的安全和资源占用风险。因此系统维护动作需要能主动收敛 stale smoke 数据。

## 维护入口

接口：

```text
POST /api/admin/system-maintenance/run
```

新增参数：

- `cleanupSmokeData`：是否清理 stale smoke 数据，默认 `true`。
- `cleanupSmokeDataAgeMinutes`：判定 stale 的最短年龄，默认 `30`，允许 `5-1440`。
- `cleanupSmokeDataLimit`：单次最多扫描的 smoke 租赁数，默认 `100`，允许 `1-500`。

后台 `可用性巡检 -> 运行安全维护` 会使用默认参数执行该清理。

## 清理范围

清理动作只处理内部 smoke 用户：

```text
admin-openai-proxy-smoke@local.invalid
```

满足以下任一条件的 smoke 租赁会被视为 stale：

- 租赁创建时间早于 cutoff。
- 租赁 `endsAt <= now`。
- 租赁存在早于 cutoff 且仍未停用的本地 API Key。
- 租赁对应订单早于 cutoff 且仍未关闭。

默认 cutoff 为当前时间向前 30 分钟。

## 清理动作

对 stale smoke 租赁，系统会执行：

- 本地 API Key 置为 `inactive`。
- 本地租赁置为 `closed`。
- 本地订单置为 `closed`。
- 对有 `sub2KeyId` 的租赁，尽力调用 Sub2API 停用对应 Key。

清理完成后，如果不存在 cutoff 之后创建的 active smoke 租赁，并且 smoke 钱包本身也早于 cutoff，系统会将 smoke 钱包可用余额和冻结余额归零。

## 返回结果

维护结果中的 `actions.cleanupSmokeData` 包含：

- `rentalsMatched`
- `rentalsClosed`
- `ordersClosed`
- `apiKeysDeactivated`
- `walletReset`
- `sub2KeysDisableAttempted`
- `sub2KeysDisabled`
- `sub2DisableFailed`
- `errors`

后台最近维护卡片会展示已清理 smoke 租赁数和 Sub2 Key 停用成功/尝试次数。

## 边界

- 默认 30 分钟阈值用于避免打断正在运行的自检。
- 清理动作不会删除 smoke Sub2Binding，因为后续 Sub2 usage 可能延迟同步回来，保留绑定可以让 usage 正确归因为 `ignored`。
- 如果 Sub2 Key 停用失败，会在返回结果中记录 `sub2DisableFailed` 和错误摘要；管理员可稍后再次运行安全维护。
- 已超过 cutoff 的 smoke 租赁会被后续维护再次扫描，因此 Sub2 Key 停用失败具备重试机会。

## 验收方式

本地验证：

- `npm --prefix user/apps/api run typecheck`
- `npm --prefix user/apps/admin run typecheck`
- `npm --prefix user/apps/api run build`
- `npm --prefix user/apps/admin run build`

线上验证建议：

1. 手动制造一个超过 30 分钟的 active smoke 租赁和 active API Key。
2. 执行 `POST /api/admin/system-maintenance/run`。
3. 确认返回 `cleanupSmokeData.rentalsClosed >= 1`。
4. 确认本地 API Key 变为 `inactive`，租赁和订单变为 `closed`。
5. 确认 smoke 钱包余额归零。
