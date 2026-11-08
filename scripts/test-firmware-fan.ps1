param(
  [string]$Compiler = 'g++'
)

$ErrorActionPreference = 'Stop'
$testRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../firmware/tests')).ProviderPath
$testBinary = Join-Path ([System.IO.Path]::GetTempPath()) ('iot-fan-test-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
  & $Compiler '-std=c++11' '-Wall' '-Wextra' '-Werror' (Join-Path $testRoot 'fan_thermostat_test.cpp') '-o' $testBinary
  if ($LASTEXITCODE -ne 0) { throw 'Firmware fan-test compilation failed' }
  & $testBinary
  if ($LASTEXITCODE -ne 0) { throw 'Firmware fan tests failed' }
} finally {
  if (Test-Path -LiteralPath $testBinary) { Remove-Item -LiteralPath $testBinary -Force }
}
