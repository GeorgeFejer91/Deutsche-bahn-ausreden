param(
    [Parameter(Mandatory = $true)][string]$ModelRoot,
    [Parameter(Mandatory = $true)][string]$NativeRuntime,
    [ValidateSet('full','4s','9s')][string]$Conditioning = 'full'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scratch = Join-Path $projectRoot '.for-ai-local\voice-preparation'
$suffix = $(if ($Conditioning -eq 'full') { '' } else { '-' + $Conditioning })
$voice = Join-Path $projectRoot ('public\voice\gs-deutsche-bahn-durchsage' + $suffix + '.json')
$cases = Join-Path $scratch ('prepared-cases' + $suffix)
$conditioningData = Get-Content -LiteralPath $voice -Raw | ConvertFrom-Json
$conditioningHash = (Get-FileHash -LiteralPath $voice -Algorithm SHA256).Hash.ToLowerInvariant()
$helper = Join-Path $PSScriptRoot 'target\release\cached-clips.exe'
$cli = Join-Path $NativeRuntime 'omnivoice-cli.exe'
if ((Get-FileHash -LiteralPath $cli -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'd0f39af9d5b74e114c95e01dd30b43b78b8c9ac0735ec613c716d079095ff17b') { throw 'Unexpected native inference binary.' }
& $helper prepare $ModelRoot $voice $cases
if ($LASTEXITCODE -ne 0) { throw 'Cached native fixture preparation failed.' }
$clips = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'clips.json') -Raw | ConvertFrom-Json
$details = @()
$priorAudioCpu = $env:OMNIVOICE_AUDIO_CPU
$env:OMNIVOICE_AUDIO_CPU = '1'
try {
    foreach ($clip in $clips) {
        $wav = Join-Path $scratch ($clip.id + '.wav')
        if (Test-Path -LiteralPath $wav) {
            if ($clip.id -ne 'excuse-01' -and -not (Test-Path -LiteralPath (Join-Path $cases ($clip.id + '\generated.json')))) { throw 'Existing clip lacks native provenance.' }
            $details += [ordered]@{ id=$clip.id; method=$(if ($clip.id -eq 'excuse-01') { 'native infer-batch with complete reference' } else { 'native deterministic stage0 with cached ' + $Conditioning + ' prompt; native CPU stage1' }); seed=$(if ($clip.id -eq 'excuse-01') { 20261012 } else { $null }); positionTemperature=$(if ($clip.id -eq 'excuse-01') { 5 } else { 0 }); numStep=32; alreadyCompleted=$true; conditioningSha256=$(if ($clip.id -eq 'excuse-01') { 'b0a4320cf6680f67255db11e948a5da8e6127fc3d95d8b1d757ce0314997aaa9' } else { $conditioningHash }); referenceFrames=$(if ($clip.id -eq 'excuse-01') { 957 } else { $conditioningData.refAudioTokens[0].Count }); conditioningSource=$(if ($clip.id -ne 'excuse-01') { $conditioningData.conditioningSource } else { $null }); croppedVoiceParity=$(if ($clip.id -ne 'excuse-01' -and $Conditioning -ne 'full') { 'PENDING: crop identity parity has not been listened to or established' } else { $null }) }
            continue
        }
        $tokens = Join-Path $cases ($clip.id + '\generated.json')
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $stage0Seconds = $null
        if (-not (Test-Path -LiteralPath $tokens)) {
            Write-Output ('Generating ' + $clip.id + ' with ' + $conditioningData.refAudioTokens[0].Count + ' reference frames.')
            $stage0Timer = [Diagnostics.Stopwatch]::StartNew()
            & $cli stage0-generate --model $ModelRoot --reference-root $cases --case $clip.id --out $tokens --device cuda:0 --dtype f16 2>&1 | Tee-Object -FilePath (Join-Path $scratch ($clip.id + $suffix + '.cached-native.log'))
            if ($LASTEXITCODE -ne 0) { throw ('Cached CUDA generation failed: ' + $clip.id) }
            $stage0Timer.Stop()
            $stage0Seconds = $stage0Timer.Elapsed.TotalSeconds
        }
        $stage1Timer = [Diagnostics.Stopwatch]::StartNew()
        & $helper decode $ModelRoot $voice $tokens $wav
        if ($LASTEXITCODE -ne 0) { throw ('Native CPU decoding failed: ' + $clip.id) }
        $stage1Timer.Stop()
        $timer.Stop()
        $details += [ordered]@{ id=$clip.id; method=('native deterministic stage0 with cached ' + $Conditioning + ' prompt; native CPU stage1'); seed=$null; positionTemperature=0; numStep=32; generationAndDecodeSeconds=$timer.Elapsed.TotalSeconds; stage0ProcessSeconds=$stage0Seconds; stage1ProcessSeconds=$stage1Timer.Elapsed.TotalSeconds; conditioningSha256=$conditioningHash; referenceFrames=$conditioningData.refAudioTokens[0].Count; conditioningSeconds=$conditioningData.conditioningSeconds; conditioningSource=$conditioningData.conditioningSource; croppedVoiceParity=$(if ($Conditioning -ne 'full') { 'PENDING: crop identity parity has not been listened to or established' } else { $null }) }
        $details | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $scratch 'clip-generation.json') -Encoding utf8
    }
} finally { $env:OMNIVOICE_AUDIO_CPU = $priorAudioCpu }
$details | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $scratch 'clip-generation.json') -Encoding utf8
Write-Output 'Native cached clip bank completed; run prepare.ps1 -Stage encode to publish MP3s and manifest.'
