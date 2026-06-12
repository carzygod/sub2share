# 系统巡检负余额问题直达
实现日期：2026-06-12

## 背景

`GET /api/admin/system-health` 已经会统计余额账户是否存在负数，但此前 `wallets` 检查项只返回 `negativeWallets` 汇总。管理员看到余额账户 error 后，需要再进入余额管理页手动查找异常钱包，无法从统一可用性巡检页直接定位用户和余额账户。

## 新增能力

- `wallets` 系统巡检项在存在负余额时返回 `detail.issues`。
- 后端会有界读取最近 20 个负余额钱包样本。
- 每个钱包按实际异常生成问题：
  - `negative_available_balance`
  - `negative_frozen_balance`
- issue 字段包含：
  - `walletId`
  - `walletAccountId`
  - `userId`
  - `userEmail`
  - `userStatus`
  - `availableBalance`
  - `frozenBalance`
  - `amount`
  - `updatedAt`
- Admin `可用性巡检` 页复用已有问题样本操作：
  - `walletId/walletAccountId` -> 打开余额账户。
  - `userId` -> 打开用户详情。

## 管理价值

- 管理员看到余额账户 error 后，可以从系统健康页直接进入异常钱包和对应用户。
- 余额扣费、退款、提现冻结或人工调整造成的负数更容易被快速定位。
- 该能力只读展示证据和跳转入口，不自动改账、不修改钱包余额或流水。

## 验证

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/admin run typecheck`
- `pnpm.cmd --filter @zyz/api exec node --import tsx --test tests/admin-wallet-health.test.ts tests/admin-reconciliation-health.test.ts`
