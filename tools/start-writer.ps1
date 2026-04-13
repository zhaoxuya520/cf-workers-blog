$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path) | Out-Null
Set-Location .. | Out-Null

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -3 tools/writer_app.py
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python tools/writer_app.py
} else {
  Write-Host "未找到 Python：请先安装 Python 3，然后重试。" -ForegroundColor Red
  exit 1
}

