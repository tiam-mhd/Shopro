$ErrorActionPreference = "Stop"

function Invoke-NativeChecked {
  param([string]$Name, [scriptblock]$Command, [switch]$Capture)
  Write-Host "ROUNDTRIP_STEP=$Name"
  if ($Capture) { $output = & $Command } else { & $Command; $output = @() }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    $details = if ($Capture) { ($output | ForEach-Object { $_.ToString() }) -join "`n" } else { "See command output above." }
    throw "$Name failed with exit code $code. $details"
  }
  if ($Capture) { return $output }
}

$toolNames = @("initdb", "pg_ctl", "createdb", "psql", "pg_dump", "pg_restore", "tar")
$tools = @{}
foreach ($toolName in $toolNames) {
  $tool = Get-Command $toolName -ErrorAction SilentlyContinue
  if (-not $tool) { throw "Required local test tool is missing: $toolName" }
  $tools[$toolName] = $tool.Source
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$tempParent = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)
$runId = [guid]::NewGuid().ToString("N")
$tempRoot = Join-Path $tempParent "shopro-backup-roundtrip-$runId"
$sourceName = "shopro_backup_src_$($runId.Substring(0, 8))"
$restoreName = "shopro_restore_$($runId.Substring(8, 12))"
$portListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portListener.Start()
$port = $portListener.LocalEndpoint.Port
$portListener.Stop()

$dataDirectory = Join-Path $tempRoot "postgres-data"
$privateFiles = Join-Path $tempRoot "private-attachments"
$backupDirectory = Join-Path $tempRoot "encrypted-backups"
$restoreFiles = Join-Path $tempRoot "restored-attachments"
$pgLog = Join-Path $tempRoot "postgres.log"
$databaseUrl = "postgresql://shopro_test@127.0.0.1:$port/$sourceName"
$restoreUrl = "postgresql://shopro_test@127.0.0.1:$port/$restoreName"
$attachmentId = [guid]::NewGuid().ToString()
$storageKey = "$attachmentId.pdf"
$attachmentBytes = [Text.Encoding]::ASCII.GetBytes("%PDF-1.7`nShopro disposable restore fixture`n")
$sha256 = [Security.Cryptography.SHA256]::Create()
$attachmentChecksum = [BitConverter]::ToString($sha256.ComputeHash($attachmentBytes)).Replace("-", "").ToLowerInvariant()
$sha256.Dispose()
$attachmentFile = Join-Path $privateFiles $storageKey
$wasStarted = $false
$savedEnvironment = @{}
$environmentNames = @("DATABASE_URL", "RESTORE_DATABASE_URL", "RESTORE_CONFIRM_DATABASE", "RESTORE_ATTACHMENT_STORAGE_DIR", "ATTACHMENT_STORAGE_DIR", "BACKUP_DIR", "BACKUP_RETENTION_DAYS", "BACKUP_ENCRYPTION_KEY", "NODE_ENV", "PG_DUMP_BIN", "PG_RESTORE_BIN", "PSQL_BIN", "TAR_BIN")

try {
  foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  New-Item -ItemType Directory -Path $privateFiles | Out-Null
  New-Item -ItemType Directory -Path $backupDirectory | Out-Null
  [IO.File]::WriteAllBytes($attachmentFile, $attachmentBytes)

  Invoke-NativeChecked "initdb" { & $tools.initdb -D $dataDirectory -U shopro_test --encoding=UTF8 --no-locale --auth-local=trust --auth-host=trust }
  Invoke-NativeChecked "pg_ctl start" { & $tools.pg_ctl -D $dataDirectory -l $pgLog -o "-h 127.0.0.1 -p $port -F" -w start }
  $wasStarted = $true
  Invoke-NativeChecked "create source database" { & $tools.createdb --no-password --host 127.0.0.1 --port $port --username shopro_test $sourceName }
  Invoke-NativeChecked "create empty restore database" { & $tools.createdb --no-password --host 127.0.0.1 --port $port --username shopro_test $restoreName }

  $env:DATABASE_URL = $databaseUrl
  $env:NODE_ENV = "development"
  Invoke-NativeChecked "Prisma migration deploy" { & npm.cmd run db:deploy }
  Invoke-NativeChecked "development seed" { & npm.cmd run db:seed }

  $businessIdOutput = Invoke-NativeChecked "find seeded business" { & $tools.psql -X -w -h 127.0.0.1 -p $port -U shopro_test -d $sourceName -At -v ON_ERROR_STOP=1 -c "SELECT id::text FROM businesses ORDER BY created_at LIMIT 1" } -Capture
  $businessId = (($businessIdOutput | ForEach-Object { $_.ToString() }) -join "").Trim()
  if ($businessId -notmatch "^[0-9a-f-]{36}$") { throw "Seed did not create a business for the backup fixture." }
  Invoke-NativeChecked "insert disposable attachment metadata" {
    & $tools.psql -X -w -h 127.0.0.1 -p $port -U shopro_test -d $sourceName -v ON_ERROR_STOP=1 -c "INSERT INTO attachments (id,business_id,storage_key,file_name,mime_type,bytes,checksum,uploaded_by) VALUES ('$attachmentId','$businessId','$storageKey','roundtrip.pdf','application/pdf',$($attachmentBytes.Length),'$attachmentChecksum','00000000-0000-4000-8000-000000000099')"
  }

  $keyBytes = New-Object byte[] 32
  $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $randomGenerator.GetBytes($keyBytes)
  $randomGenerator.Dispose()
  $env:ATTACHMENT_STORAGE_DIR = $privateFiles
  $env:BACKUP_DIR = $backupDirectory
  $env:BACKUP_RETENTION_DAYS = "30"
  $env:BACKUP_ENCRYPTION_KEY = [Convert]::ToBase64String($keyBytes)
  $env:PG_DUMP_BIN = $tools.pg_dump
  $env:PG_RESTORE_BIN = $tools.pg_restore
  $env:PSQL_BIN = $tools.psql
  $env:TAR_BIN = $tools.tar
  $backupOutput = Invoke-NativeChecked "encrypted backup" { & node scripts/backup/backup.mjs } -Capture
  $backupEvent = (($backupOutput | ForEach-Object { $_.ToString() }) | Where-Object { $_.StartsWith("{") } | Select-Object -Last 1) | ConvertFrom-Json
  if ($backupEvent.event -ne "backup.completed" -or $backupEvent.attachmentCount -ne 1) { throw "Backup did not report the expected disposable attachment." }

  $env:RESTORE_DATABASE_URL = $restoreUrl
  $env:RESTORE_CONFIRM_DATABASE = $restoreName
  $env:RESTORE_ATTACHMENT_STORAGE_DIR = $restoreFiles
  $restoreOutput = Invoke-NativeChecked "isolated encrypted restore" { & node scripts/backup/restore.mjs $backupEvent.backup } -Capture
  $restoreEvent = (($restoreOutput | ForEach-Object { $_.ToString() }) | Where-Object { $_.StartsWith("{") } | Select-Object -Last 1) | ConvertFrom-Json
  if ($restoreEvent.event -ne "restore.completed" -or $restoreEvent.attachmentCount -ne 1) { throw "Restore did not report completion with the expected attachment." }

  $countsQuery = "SELECT (SELECT count(*) FROM businesses)::text || '|' || (SELECT count(*) FROM branches)::text || '|' || (SELECT count(*) FROM products)::text || '|' || (SELECT count(*) FROM journal_entries)::text || '|' || (SELECT count(*) FROM attachments)::text"
  $sourceCountsOutput = Invoke-NativeChecked "source row-count check" { & $tools.psql -X -w -h 127.0.0.1 -p $port -U shopro_test -d $sourceName -At -v ON_ERROR_STOP=1 -c $countsQuery } -Capture
  $restoredCountsOutput = Invoke-NativeChecked "restored row-count check" { & $tools.psql -X -w -h 127.0.0.1 -p $port -U shopro_test -d $restoreName -At -v ON_ERROR_STOP=1 -c $countsQuery } -Capture
  $sourceCounts = (($sourceCountsOutput | ForEach-Object { $_.ToString() }) -join "").Trim()
  $restoredCounts = (($restoredCountsOutput | ForEach-Object { $_.ToString() }) -join "").Trim()
  if ($sourceCounts -ne $restoredCounts) { throw "Source and restored database row counts differ: $sourceCounts vs $restoredCounts." }

  $restoredFile = Join-Path $restoreFiles $storageKey
  $restoredHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $restoredFile).Hash.ToLowerInvariant()
  if ($restoredHash -ne $attachmentChecksum) { throw "Restored receipt checksum does not match the source fixture." }
  Write-Output "BACKUP_RESTORE_ROUNDTRIP=PASS"
  Write-Output "SOURCE_AND_RESTORED_COUNTS=$sourceCounts"
  Write-Output "ATTACHMENT_SHA256=$restoredHash"
} finally {
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], "Process") }
  if ($wasStarted) {
    & $tools.pg_ctl -D $dataDirectory -m fast -w stop 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "Temporary PostgreSQL cluster could not be stopped; retained its temporary directory: $tempRoot" }
  }
  $resolvedRoot = [IO.Path]::GetFullPath($tempRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $resolvedParent = [IO.Path]::GetDirectoryName($resolvedRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $resolvedTempParent = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $leaf = [IO.Path]::GetFileName($resolvedRoot)
  if ($resolvedParent -eq $resolvedTempParent -and $leaf -match "^shopro-backup-roundtrip-[0-9a-f]{32}$" -and (-not $wasStarted -or $LASTEXITCODE -eq 0)) {
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
  } else {
    Write-Warning "Temporary round-trip directory was retained because its path or PostgreSQL shutdown did not pass safety checks: $resolvedRoot"
  }
}
