$ErrorActionPreference = "Stop"

pnpm install --frozen-lockfile
pnpm db:generate
pnpm typecheck
pnpm build

