# API CORS 白名单策略

实现日期：2026-06-11

## 背景

生产环境此前使用 `origin: true`，会反射任意浏览器 Origin。虽然接口仍有鉴权，但这不符合生产前安全要求，也不利于管理员判断浏览器端调用边界。本次将 API CORS 收敛为生产白名单，同时保留开发和测试环境的便利性。

## 已实现范围

- 非生产环境继续允许任意 Origin，方便本地开发、测试和临时调试。
- 生产环境只允许白名单 Origin。
- 白名单来源：
  - `CORS_ALLOWED_ORIGINS`
  - `APP_PUBLIC_URL`
  - `ADMIN_PUBLIC_URL`
  - `API_PUBLIC_URL`
  - `OPENAI_PROXY_PUBLIC_ENDPOINT` 的 origin
- `CORS_ALLOWED_ORIGINS` 使用英文逗号分隔完整 origin，例如：

```env
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,https://api.example.com
```

- 生产环境显式拒绝 `*`，避免恢复任意 Origin。
- API 仍通过 `Access-Control-Expose-Headers` 暴露 `x-proxy-request-id`，方便浏览器端排障 OpenAI/Codex 反代请求。
- `GET /api/admin/system-health` 新增 `corsPolicy` 检查项：
  - 生产环境没有可解析白名单时标记 error。
  - 生产环境配置 `*` 时标记 error。
  - 无效 URL 会作为 warning issue 返回。
  - metrics 会展示是否 enforce、白名单数量、配置数量、无效数量和暴露头。

## 管理员价值

- 管理员可以在可用性巡检里确认生产 API 不再接受任意 Origin。
- 当后台或用户端域名新增时，可通过 `CORS_ALLOWED_ORIGINS` 明确扩展，不需要改代码。
- 浏览器端仍能读取 `x-proxy-request-id`，不会牺牲反代排障体验。

## 验证方式

- `pnpm.cmd --filter @zyz/api run typecheck`
- `pnpm.cmd --filter @zyz/api test`
- `pnpm.cmd --filter @zyz/api run build`
