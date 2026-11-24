$ErrorActionPreference = 'Stop'

Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

function Test-TcpPort {
  param([int]$Port)
  return [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue)
}

function Start-NodeService {
  param([int]$Port, [string]$Command, [string]$Name)
  if (Test-TcpPort -Port $Port) {
    Write-Host "$Name already listening on port $Port; reusing it."
    return
  }
  Write-Host "Starting $Name on port $Port..."
  Start-Process -FilePath 'npm.cmd' -ArgumentList $Command -WorkingDirectory (Get-Location) -WindowStyle Minimized
}

$besuRpc = Test-TcpPort -Port 9545
if (-not $besuRpc) {
  throw 'Besu RPC is not listening on 127.0.0.1:9545. Start Besu separately; this script intentionally does not modify or restart the blockchain.'
}

if (-not (Test-TcpPort -Port 3001)) {
  Start-Process -FilePath 'node.exe' -ArgumentList '.\indexer\main.mjs' -WorkingDirectory (Get-Location) -WindowStyle Minimized
  Write-Host 'Starting DIGEVRA Indexer on port 3001...'
} else {
  Write-Host 'DIGEVRA Indexer already listening on port 3001; reusing it.'
}

if (-not (Test-TcpPort -Port 4201)) {
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'run start:explorer' -WorkingDirectory (Get-Location) -WindowStyle Minimized
  Write-Host 'Starting DIGEVRA Explorer on port 4201...'
} else {
  Write-Host 'DIGEVRA Explorer already listening on port 4201; reusing it.'
}

if (-not (Test-TcpPort -Port 4200)) {
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'run start' -WorkingDirectory (Get-Location) -WindowStyle Minimized
  Write-Host 'Starting Angular DIGEVRA Wallet on port 4200...'
} else {
  Write-Host 'DIGEVRA Wallet already listening on port 4200; reusing it.'
}

Write-Host 'Local services: http://localhost:4200, http://localhost:4201, http://127.0.0.1:3001, RPC http://127.0.0.1:9545'
