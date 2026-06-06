$ErrorActionPreference = "Stop"

$repo = Join-Path $PSScriptRoot "..\upstream\sub2api"
docker compose -f (Join-Path $repo "deploy\docker-compose.local.yml") up -d

