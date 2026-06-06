$ErrorActionPreference = "Stop"

$repo = Join-Path $PSScriptRoot "..\upstream\sub2api"
if (!(Test-Path (Join-Path $repo ".git"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $repo) | Out-Null
  git clone --depth=1 https://github.com/Wei-Shaw/sub2api.git $repo
} else {
  git -C $repo fetch --depth=1 origin main
  git -C $repo checkout -B main FETCH_HEAD
}

