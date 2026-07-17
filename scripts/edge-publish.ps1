<#
  Edge Add-ons 发布：打包 dist -> 上传 -> 轮询 -> 发布 -> 轮询
  凭证只从环境变量读（本地见 .secrets/，CI 见 GitHub Secrets），脚本内不含任何密钥。
  兼容 Windows PowerShell 5.1（本地）与 PowerShell 7 / pwsh（GitHub Actions）。

  用法（本地手动兜底，须自行设置环境变量作为显式授权）：
    $env:EDGE_API_KEY='...'; $env:EDGE_CLIENT_ID='...'; $env:EDGE_PRODUCT_ID='...'
    powershell -ExecutionPolicy Bypass -File scripts/edge-publish.ps1
  参数：
    -SkipBuild        跳过 npm run build（直接用现有 dist/，CI 里用）
    -Notes "说明"     发布说明

  日常发布走 GitHub Release 触发（见 .github/workflows/edge-publish.yml）。
  注意：发布前须抬高 public/manifest.json 的 version（须大于商店线上版本）。
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$apiKey   = $env:EDGE_API_KEY
$clientId = $env:EDGE_CLIENT_ID
$product  = $env:EDGE_PRODUCT_ID
if (-not $apiKey -or -not $clientId -or -not $product) {
  throw '缺少环境变量：需要 EDGE_API_KEY / EDGE_CLIENT_ID / EDGE_PRODUCT_ID'
}

$root    = Split-Path -Parent $PSScriptRoot
$dist    = Join-Path $root 'dist'
$base    = 'https://api.addons.microsoftedge.microsoft.com'
$headers = @{ Authorization = "ApiKey $apiKey"; 'X-ClientID' = $clientId }

function Get-Location1([object]$resp) {
  $loc = $resp.Headers['Location']
  if ($loc -is [array]) { return $loc[0] }
  return $loc
}

function Wait-Op([string]$url, [string]$label) {
  for ($i = 0; $i -lt 60; $i++) {
    $s = Invoke-RestMethod -Uri $url -Headers $headers
    Write-Host ("   [{0}] status={1}" -f $label, $s.status)
    if ($s.status -eq 'Succeeded') { return $s }
    if ($s.status -eq 'Failed') {
      throw ("{0} 失败: {1} {2}" -f $label, $s.message, ($s.errors | ConvertTo-Json -Compress))
    }
    Start-Sleep -Seconds 10
  }
  throw "$label 轮询超时"
}

# 1) 构建
if (-not $SkipBuild) {
  Write-Host '==> npm run build'
  Push-Location $root
  try { npm run build; if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败' } }
  finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $dist 'manifest.json'))) { throw 'dist/manifest.json 不存在，请先构建' }

$ver = (Get-Content (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json).version
Write-Host "==> 待发布版本 $ver"

# 2) 打包 dist -> zip（manifest 位于 zip 根，正斜杠路径）
$zip = Join-Path ([System.IO.Path]::GetTempPath()) ("pigeondeck-{0}-{1}.zip" -f $ver, (Get-Random))
if (Test-Path $zip) { Remove-Item $zip -Force }
try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch {}
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $dist, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Write-Host ("==> 打包 {0} ({1} KB)" -f $zip, [math]::Round((Get-Item $zip).Length / 1KB))

try {
  # 3) 上传新包
  Write-Host '==> 上传包'
  $up   = Invoke-WebRequest -Uri "$base/v1/products/$product/submissions/draft/package" -Method Post -Headers $headers -ContentType 'application/zip' -InFile $zip -UseBasicParsing
  $opId = Get-Location1 $up
  if (-not $opId) { throw '上传未返回 Location/operationID' }
  Write-Host "   operationID = $opId"
  Wait-Op "$base/v1/products/$product/submissions/draft/package/operations/$opId" '上传' | Out-Null

  # 4) 发布
  Write-Host '==> 发布提交'
  $body  = if ($Notes) { @{ notes = $Notes } | ConvertTo-Json } else { '{}' }
  $pub   = Invoke-WebRequest -Uri "$base/v1/products/$product/submissions" -Method Post -Headers $headers -ContentType 'application/json' -Body $body -UseBasicParsing
  $pubOp = Get-Location1 $pub
  if (-not $pubOp) { throw '发布未返回 Location/operationID' }
  Write-Host "   publish operationID = $pubOp"
  Wait-Op "$base/v1/products/$product/submissions/operations/$pubOp" '发布' | Out-Null
}
finally {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

Write-Host "OK 发布流程完成（版本 $ver）。后续由微软审核，通常数小时~数天。"
