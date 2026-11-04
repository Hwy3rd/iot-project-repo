param(
  [Parameter(Mandatory = $true)][string]$ArduinoJsonInclude,
  [string]$Compiler = 'g++'
)

$ErrorActionPreference = 'Stop'
$testRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../firmware/tests')).ProviderPath
$jsonInclude = (Resolve-Path -LiteralPath $ArduinoJsonInclude).ProviderPath
$testBinary = Join-Path ([System.IO.Path]::GetTempPath()) ('iot-offline-test-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
  & $Compiler '-std=c++11' '-Wall' '-Wextra' ('-I' + $jsonInclude) ('-I' + (Join-Path $testRoot 'stubs')) (Join-Path $testRoot 'offline_telemetry_test.cpp') '-o' $testBinary
  if ($LASTEXITCODE -ne 0) { throw 'Firmware host-test compilation failed' }
  & $testBinary
  if ($LASTEXITCODE -ne 0) { throw 'Firmware recovery tests failed' }
} finally {
  if (Test-Path -LiteralPath $testBinary) { Remove-Item -LiteralPath $testBinary -Force }
}
