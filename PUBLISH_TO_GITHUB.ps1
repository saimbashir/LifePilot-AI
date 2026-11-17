# LifePilot AI - publish sanitized project source to an existing GitHub repository.
# Run from PowerShell inside the folder extracted from LifePilot-AI-GitHub-Ready.zip.
# Git for Windows is required. Github may open a browser for user sign-in.
$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/saimbashir/LifePilot-AI.git'
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
$Work = Join-Path $env:TEMP 'LifePilot-AI-github-publish'

Write-Host 'LifePilot AI | Safe GitHub Publisher' -ForegroundColor Cyan
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git is not installed. Install Git for Windows, reopen PowerShell, and try again.'
}
if (-not (Test-Path (Join-Path $Source 'backend/src/server.mjs'))) {
  throw 'Missing backend source. Extract the ENTIRE ZIP before publishing.'
}
if (-not (Test-Path (Join-Path $Source 'src/App.tsx'))) {
  throw 'Missing React source. Extract the ENTIRE ZIP before publishing.'
}
if (Test-Path $Work) {
  throw "Temporary clone location already exists: $Work. Check it, then remove it yourself if safe."
}

git clone $RepoUrl $Work
if ($LASTEXITCODE -ne 0) { throw 'Git clone failed. Check browser sign-in or repository access.' }

$copyArgs = @($Source, $Work, '/E', '/XF', 'PUBLISH_TO_GITHUB.ps1', 'tsconfig.tsbuildinfo', '/XD', '.git', 'node_modules', 'dist', 'private', '.gradle', 'persistent', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS')
& robocopy @copyArgs | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Project source copy failed.' }

Push-Location $Work
try {
  git add -A
  if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
  $staged = @(git diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'Git staged diff failed.' }
  if ($staged.Count -lt 80) {
    throw "Only $($staged.Count) files staged; expected full project (80+). Check extracted ZIP before publishing."
  }
  $forbidden = @($staged | Where-Object {
    $_ -match '(^|/)(\.env$|private/|node_modules/|dist/)' -or
    $_ -match '(\.sqlite($|[-.])|\.db$|\.pem$|\.key$|\.keystore$|\.jks$|tsconfig\.tsbuildinfo$)'
  })
  if ($forbidden.Count -gt 0) {
    Write-Host 'BLOCKED private paths:' -ForegroundColor Red
    $forbidden | ForEach-Object { Write-Host $_ }
    throw 'Refusing to push secrets or generated files.'
  }
  Write-Host "Staged $($staged.Count) files. First 20 paths:" -ForegroundColor Green
  $staged | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
  Write-Host 'Committing the latest sanitized LifePilot AI source.' -ForegroundColor Yellow
  git commit -m 'feat: publish complete LifePilot AI portfolio source and docs'
  if ($LASTEXITCODE -ne 0) { throw 'Git commit failed. Configure git user.name and user.email if prompted.' }
  git push origin main
  if ($LASTEXITCODE -ne 0) { throw 'Git push failed. Check sign-in and repository write access.' }
  Write-Host 'SUCCESS: Project pushed to https://github.com/saimbashir/LifePilot-AI' -ForegroundColor Green
  Write-Host 'Check src/, backend/, docs/, cloud/, android/, and .github/workflows/ on GitHub.'
} finally {
  Pop-Location
}
