param([string]$Output = (Join-Path $PSScriptRoot '../runtime/models/jarvis-memory'))

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$model = 'Xenova/bge-small-zh-v1.5'
$revision = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
$files = @{
  'config.json' = 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f'
  'tokenizer.json' = '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26'
  'tokenizer_config.json' = 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a'
  'special_tokens_map.json' = 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3'
  'vocab.txt' = '45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c'
  'onnx/model_quantized.onnx' = '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc'
}

$targetRoot = [IO.Path]::GetFullPath($Output)
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}
foreach ($entry in $files.GetEnumerator()) {
  $relative = $entry.Key.Replace('/', [IO.Path]::DirectorySeparatorChar)
  $target = Join-Path $targetRoot $relative
  $expected = $entry.Value
  $valid = $false
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    $actual = Get-Sha256 $target
    $valid = $actual -eq $expected
  }
  if (-not $valid) {
    $directory = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = "$target.download"
    $url = "https://huggingface.co/$model/resolve/$revision/$($entry.Key)"
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temporary
    $actual = Get-Sha256 $temporary
    if ($actual -ne $expected) {
      Remove-Item -LiteralPath $temporary -Force
      throw "模型文件校验失败：$relative"
    }
    Move-Item -LiteralPath $temporary -Destination $target -Force
  }
}

$manifest = @{ model = $model; revision = $revision; files = $files }
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $targetRoot 'jarvis-model.json') -Encoding utf8
Write-Output "已验证并准备本地模型：$targetRoot"
