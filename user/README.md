# 智算驿站 User Platform

`app/user` 是智算驿站的业务系统，负责买家、供给方、订单、钱包、租赁、计费、分润和运营后台。

Sub2API 仅作为中转网关内核使用，业务系统通过 `Sub2ApiClient` 与其集成。

## Apps

| App | 说明 |
| --- | --- |
| `apps/api` | 业务 API 与异步任务 |
| `apps/web` | 买家端与供给方端 |
| `apps/admin` | 运营后台 |

## Packages

| Package | 说明 |
| --- | --- |
| `packages/shared` | 共享类型、枚举、常量 |
| `packages/ui` | 共享 UI 组件 |

## Local Start

```bash
pnpm install
pnpm db:generate
pnpm dev
```

