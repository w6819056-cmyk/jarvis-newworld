$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'download-hand-landmarker.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Hand Landmarker model download failed' }
$modelName = 'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-int8-2026-06-05'
$modelRoot = Join-Path $PSScriptRoot '../runtime/models'
$archive = Join-Path $modelRoot "$modelName.tar.bz2"
$expected = '14919F03B74D9001FC8F2689C2AB1EA42C436DB269E8C809144492F41612BFFF'
New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
if (!(Test-Path -LiteralPath $archive)) {
    Write-Host 'Downloading the local Chinese/English speech model (134 MB)...'
    Invoke-WebRequest "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$modelName.tar.bz2" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
    throw 'Model archive checksum does not match. Remove the archive and retry.'
}
tar -xjf $archive -C $modelRoot
if ($LASTEXITCODE -ne 0) { throw 'Model extraction failed' }
Write-Host 'Local speech model is ready.'
