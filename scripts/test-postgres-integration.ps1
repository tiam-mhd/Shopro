param([switch]$HttpOnly, [switch]$Perf, [switch]$OtpOnly)

$ErrorActionPreference = "Stop"
if (@($HttpOnly, $Perf, $OtpOnly).Where({ $_ }).Count -gt 1) { throw "Choose only one integration profile." }

function Invoke-NativeChecked {
  param([string]$Name, [scriptblock]$Command)
  Write-Host "INTEGRATION_STEP=$Name"
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

$toolNames = @("initdb", "pg_ctl", "createdb")
$tools = @{}
foreach ($toolName in $toolNames) {
  $tool = Get-Command $toolName -ErrorAction SilentlyContinue
  if (-not $tool) { throw "Required local test tool is missing: $toolName" }
  $tools[$toolName] = $tool.Source
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$tempParent = [IO.Path]::GetFullPath((Join-Path $repoRoot ".tmp"))
$runId = [guid]::NewGuid().ToString("N")
$tempRoot = [IO.Path]::GetFullPath((Join-Path $tempParent "shopro-postgres-integration-$runId"))
if (-not $tempRoot.StartsWith($tempParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use an integration directory outside the workspace .tmp folder."
}
$databaseName = "shopro_integration_test_$($runId.Substring(0, 12))"
$portListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portListener.Start()
$port = $portListener.LocalEndpoint.Port
$portListener.Stop()
$dataDirectory = Join-Path $tempRoot "postgres-data"
$pgLog = Join-Path $tempRoot "postgres.log"
$databaseUrl = "postgresql://shopro_test@127.0.0.1:$port/$databaseName"
$wasStarted = $false
$stoppedCleanly = $true
$savedDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$savedNodeEnv = [Environment]::GetEnvironmentVariable("NODE_ENV", "Process")
$savedCapacityFlag = [Environment]::GetEnvironmentVariable("SHOPRO_RUN_HTTP_CAPACITY", "Process")
$savedDisposableFlag = [Environment]::GetEnvironmentVariable("SHOPRO_TEST_CLUSTER_DISPOSABLE", "Process")

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  Invoke-NativeChecked "initdb" { & $tools.initdb -D $dataDirectory -U shopro_test --encoding=UTF8 --no-locale --auth-local=trust --auth-host=trust }
  Invoke-NativeChecked "start disposable PostgreSQL" { & $tools.pg_ctl -D $dataDirectory -l $pgLog -o "-h 127.0.0.1 -p $port -F" -w start }
  $wasStarted = $true
  Invoke-NativeChecked "create disposable database" { & $tools.createdb --no-password --host 127.0.0.1 --port $port --username shopro_test $databaseName }

  $env:DATABASE_URL = $databaseUrl
  $env:NODE_ENV = "development"
  $env:SHOPRO_TEST_CLUSTER_DISPOSABLE = "1"
  Invoke-NativeChecked "apply all current migrations" { & npm.cmd run db:deploy }
  if ($HttpOnly) {
    Invoke-NativeChecked "build contracts for HTTP integration" { & npm.cmd run build -w @shopro/contracts }
    Invoke-NativeChecked "build API for HTTP integration" { & npm.cmd run build -w @shopro/api }
    Invoke-NativeChecked "run HTTP authorization integration" { & node scripts/test-http-authorization-postgres.mjs }
  } elseif ($OtpOnly) {
    Invoke-NativeChecked "build contracts for OTP integration" { & npm.cmd run build -w @shopro/contracts }
    Invoke-NativeChecked "build API for OTP integration" { & npm.cmd run build -w @shopro/api }
    Invoke-NativeChecked "run OTP integration" { & node scripts/test-otp-postgres.mjs }
  } elseif ($Perf) {
    Invoke-NativeChecked "build contracts for HTTP capacity profile" { & npm.cmd run build -w @shopro/contracts }
    Invoke-NativeChecked "build API for HTTP capacity profile" { & npm.cmd run build -w @shopro/api }
    $env:SHOPRO_RUN_HTTP_CAPACITY = "1"
    Invoke-NativeChecked "run configurable 20-VU HTTP capacity profile" { & node scripts/test-receivable-pagination-postgres.mjs }
  } else {
    Invoke-NativeChecked "run PostgreSQL integration suite" { & npm.cmd run test:integration }
  }
} finally {
  if ($wasStarted) {
    & $tools.pg_ctl -D $dataDirectory -m fast -w stop
    if ($LASTEXITCODE -ne 0) {
      $stoppedCleanly = $false
      Write-Warning "Disposable PostgreSQL may not have stopped cleanly; retaining its data directory and log: $pgLog"
    }
  }
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $savedDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("NODE_ENV", $savedNodeEnv, "Process")
  [Environment]::SetEnvironmentVariable("SHOPRO_RUN_HTTP_CAPACITY", $savedCapacityFlag, "Process")
  [Environment]::SetEnvironmentVariable("SHOPRO_TEST_CLUSTER_DISPOSABLE", $savedDisposableFlag, "Process")
  if ($stoppedCleanly -and (Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($tempParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
