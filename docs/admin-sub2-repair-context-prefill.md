# 管理员 Sub2 修复上下文预填

## 背景

系统健康报告已经能识别 `openai_group_has_no_active_accounts`，并在问题行里给出优先修复的 Sub2 OpenAI 账号、供给方邮箱和可能的共享资源信息。管理员点击“打开反代状态”后，如果这些字段没有继续带到 Apply OpenAI Credentials 表单，仍然需要手动复制账号、资源或供给方信息。

## 功能

- 系统健康 issue 行点击“打开反代状态”时，会携带：
  - `sub2AccountId`
  - `resourceId`
  - `supplierEmail`
  - `resourceType`
  - `resourceStatus`
- 系统健康 sample 行也会读取并携带同类字段。
- 当某条 Sub2 修复问题缺少 `supplierEmail`，但系统内恰好只有一个 active 供给方时，健康报告会把该供给方邮箱作为修复候选补入问题上下文。
- Admin “反代状态”页会使用该上下文：
  - 自动预选 Sub2 OpenAI 账号。
  - 自动预填目标共享资源 ID。
  - 自动预填供给方邮箱。
  - 当存在资源 ID 或供给方邮箱时，默认勾选“保存为共享资源凭据”。
- 表单会随修复上下文变化重新挂载，避免上一次问题行的默认值残留。

## 管理价值

- 管理员从可用性巡检进入修复页后，可以直接粘贴有效 OpenAI refresh token。
- 如果健康报告已经定位到供给方或共享资源，保存资源凭据时无需再次查找。
- 对当前 `openai_group_has_no_active_accounts` 阻断，修复路径从“定位账号 -> 打开反代页 -> 手填资源同步信息”缩短为“打开反代页 -> 粘贴 token -> 确认应用和保存”。
