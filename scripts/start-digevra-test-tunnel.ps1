$ErrorActionPreference = 'Stop'

$rpcUrl = 'http://127.0.0.1:9545'
$indexerHealthUrl = 'http://127.0.0.1:3001/api/health'
$explorerUrl = 'http://127.0.0.1:4201'
$expectedChainId = '0x135289b'
$expectedGenesisHash = '0xb6448c0fac400f410a13813a9757faec163bb41d9a75e454466ba2c3116ed04e'

$cloudflared = Get-Command 'cloudflared' -ErrorAction SilentlyContinue
$cloudflaredPath = if ($cloudflared) {
  $cloudflared.Source
} else {
  Join-Path $env:LOCALAPPDATA 'Programs\cloudflared\cloudflared.exe'
}
if (-not (Test-Path -LiteralPath $cloudflaredPath -PathType Leaf)) {
  throw 'cloudflared is not installed or could not be located.'
}

$chain = Invoke-RestMethod -Uri $rpcUrl -Method Post -ContentType 'application/json' `
  -Body '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
if ($chain.result -ne $expectedChainId) {
  throw "Unexpected Besu Chain ID: $($chain.result). Tunnel was not started."
}

$genesis = Invoke-RestMethod -Uri $rpcUrl -Method Post -ContentType 'application/json' `
  -Body '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x0",false],"id":2}'
if ($genesis.result.hash -ne $expectedGenesisHash) {
  throw 'Unexpected Besu genesis hash. Tunnel was not started.'
}

$indexer = Invoke-RestMethod -Uri $indexerHealthUrl -Method Get
if ($indexer.state -ne 'ready' -or $indexer.chainId -ne 20261019 -or -not $indexer.historyComplete) {
  throw 'Indexer is not ready with complete DIGEVRA history. Tunnel was not started.'
}

$explorer = Invoke-WebRequest -Uri $explorerUrl -Method Get -UseBasicParsing
if ($explorer.StatusCode -ne 200) {
  throw 'DIGEVRA Explorer is not responding. Tunnel was not started.'
}

Write-Output 'Starting a temporary Cloudflare Quick Tunnel to the restricted Explorer RPC proxy.'
Write-Output 'The generated URL is temporary. Do not configure it as a production endpoint.'
Write-Output 'Besu remains bound to localhost; RPC proxy methods are allowlisted and rate-limited.'
& $cloudflaredPath tunnel --url $explorerUrl
