param(
    [Parameter(Mandatory = $true)][string]$ModelRoot,
    [Parameter(Mandatory = $true)][string]$ReferencePath,
    [Parameter(Mandatory = $true)][string]$NativeRuntime
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scratch = Join-Path $projectRoot '.for-ai-local\voice-preparation'
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
$sourceHash = '7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c'
if ((Hash $ReferencePath) -ne $sourceHash) { throw 'Unexpected saved profile reference.' }
$voicePath = Join-Path $projectRoot 'public\voice\gs-deutsche-bahn-durchsage-4s.json'
if ((Hash $voicePath) -ne '06a12ae8736b2342d08cb3a9512d0dcb3d2d2a3cefe5bba52383cf078d650301') { throw 'Cropped conditioning changed.' }
$voice = Get-Content -LiteralPath $voicePath -Raw | ConvertFrom-Json
$ffmpeg = Join-Path $NativeRuntime 'ffmpeg.exe'
$cli = Join-Path $NativeRuntime 'omnivoice-cli.exe'
if ((Hash $ffmpeg) -ne '1403b8a8a70054f1b8659e3481156e12b3cdb9d99ddc3c2a33b556e50db1e039' -or (Hash $cli) -ne 'd0f39af9d5b74e114c95e01dd30b43b78b8c9ac0735ec613c716d079095ff17b') { throw 'Unexpected native runtime binary.' }
$derived = Join-Path $scratch 'reference-4s.wav'
& $ffmpeg -hide_banner -loglevel error -y -i $ReferencePath -ss 6 -t 4 -ac 1 -ar 24000 -codec:a pcm_f32le -map_metadata -1 $derived
if ($LASTEXITCODE -ne 0) { throw 'Exact saved-reference crop failed.' }
$reader = [IO.BinaryReader]::new([IO.File]::OpenRead($derived))
try {
    if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'RIFF') { throw 'Expected RIFF crop.' }
    $null = $reader.ReadUInt32()
    if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'WAVE') { throw 'Expected WAVE crop.' }
    $pcm = $null; $format = 0; $rate = 0; $channels = 0; $bits = 0
    while ($reader.BaseStream.Position + 8 -le $reader.BaseStream.Length) {
        $chunk = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
        $size = $reader.ReadUInt32(); $end = $reader.BaseStream.Position + $size
        if ($end -gt $reader.BaseStream.Length) { throw 'Truncated derived WAV.' }
        if ($chunk -eq 'fmt ') {
            $format = $reader.ReadUInt16(); $channels = $reader.ReadUInt16(); $rate = $reader.ReadUInt32()
            $null = $reader.ReadUInt32(); $null = $reader.ReadUInt16(); $bits = $reader.ReadUInt16()
            if ($format -eq 65534 -and $size -ge 40) { $reader.BaseStream.Position += 8; $format = $reader.ReadUInt16() }
        } elseif ($chunk -eq 'data') { $pcm = $reader.ReadBytes($size) }
        $reader.BaseStream.Position = $end + ($size % 2)
    }
    if ($format -ne 3 -or $rate -ne 24000 -or $channels -ne 1 -or $bits -ne 32 -or $pcm.Length -ne 384000) { throw 'Crop is not exactly 96000 float32 mono samples.' }
    $pcmHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($pcm)).ToLowerInvariant()
    if ($pcmHash -ne $voice.conditioningSource.pcmSha256) { throw 'Derived WAV samples differ from the encoded 4s conditioning.' }
} finally { $reader.Dispose() }
$crop = [ordered]@{ wavSha256=(Hash $derived); pcmSha256=$pcmHash; conditioningSha256=(Hash $voicePath); referenceFrames=100; conditioningSeconds=4; conditioningSource=$voice.conditioningSource; refText=$voice.refText; croppedVoiceParity='PENDING: crop voice identity parity has not been established by listening' }
$crop | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $scratch 'live-crop-reference.json') -Encoding utf8
$clips = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'clips.json') -Raw | ConvertFrom-Json)
$remaining = @($clips | Where-Object { $_.id -ne 'excuse-01' -and -not (Test-Path -LiteralPath (Join-Path $scratch ($_.id + '.wav'))) })
if ($remaining.Count -eq 0) {
    $savedDetails = @(Get-Content -LiteralPath (Join-Path $scratch 'clip-generation.json') -Raw | ConvertFrom-Json)
    if ($savedDetails.Count -ne 6 -or @($savedDetails | Where-Object { $_.id -ne 'excuse-01' -and $_.derivedWavSha256 -ne $crop.wavSha256 }).Count) { throw 'Existing bank lacks matching live crop provenance.' }
    Write-Output 'All native WAVs already complete; existing generation provenance retained.'
    exit 0
}
if ($remaining.Count -ne 5) { throw 'Partial bank found: preserve existing logs and reconcile completed provenance before resuming.' }
$testList = Join-Path $scratch 'live-crop-clips.jsonl'
$rows = @($remaining | ForEach-Object { [ordered]@{id=$_.id; text=$_.text; ref_audio=$derived; ref_text=$voice.refText; language_id='de'} | ConvertTo-Json -Compress })
[IO.File]::WriteAllLines($testList, $rows, [Text.UTF8Encoding]::new($false))
$log = Join-Path $scratch 'live-crop-generation.log'
$priorAudioCpu = $env:OMNIVOICE_AUDIO_CPU; $priorTime = $env:OMNIVOICE_STAGE_TIME
$env:OMNIVOICE_AUDIO_CPU = '1'; $env:OMNIVOICE_STAGE_TIME = '1'
$timer = [Diagnostics.Stopwatch]::StartNew()
try {
    if ($remaining.Count) {
        Write-Output ('Live CUDA infer-batch: ' + $remaining.Count + ' clips, 4s exact crop, 32 steps, seed 20261012.')
        & $cli infer-batch --model $ModelRoot --test-list $testList --res-dir $scratch --device cuda:0 --dtype f16 --batch-size 1 --nj-per-gpu 1 --warmup 0 --preprocess-prompt false --postprocess-output true --num-step 32 --seed 20261012 --guidance-scale 2 --t-shift 0.1 --layer-penalty-factor 5 --position-temperature 5 --class-temperature 0 2>&1 | Tee-Object -FilePath $log
        if ($LASTEXITCODE -ne 0) { throw 'Live cropped native inference failed; retain completed WAVs and logs.' }
    }
} finally { $env:OMNIVOICE_AUDIO_CPU=$priorAudioCpu; $env:OMNIVOICE_STAGE_TIME=$priorTime }
$timer.Stop()
$timings = @()
if (Test-Path -LiteralPath $log) { $timings = @(Get-Content -LiteralPath $log | ForEach-Object { if ($_ -match '^\[stage\] name=(\w+) ms=([0-9.]+)') { [pscustomobject]@{name=$Matches[1]; seconds=[double]$Matches[2]/1000} } }) }
$details = @([ordered]@{id='excuse-01'; method='native infer-batch with complete reference'; seed=20261012; positionTemperature=5; numStep=32; referenceFrames=957; conditioningSha256='b0a4320cf6680f67255db11e948a5da8e6127fc3d95d8b1d757ce0314997aaa9'; alreadyCompleted=$true})
for ($index=0; $index -lt $remaining.Count; $index++) {
    $clip = $remaining[$index]
    if (-not (Test-Path -LiteralPath (Join-Path $scratch ($clip.id + '.wav')))) { throw ('Missing completed native WAV: ' + $clip.id) }
    $stages = @($timings | Select-Object -Skip ($index*4) -First 4)
    if ($stages.Count -ne 4 -or $stages[0].name -ne 'stage_materialize' -or $stages[2].name -ne 'stage0_generate' -or $stages[3].name -ne 'stage1_decode') { throw 'Unexpected live stage timing sequence.' }
    $details += [ordered]@{id=$clip.id; method='native infer-batch live CUDA path with explicit 4s saved-reference derivative'; seed=20261012; positionTemperature=5; classTemperature=0; guidanceScale=2; tShift=0.1; layerPenaltyFactor=5; numStep=32; referenceFrames=100; conditioningSeconds=4; conditioningSha256=$crop.conditioningSha256; derivedWavSha256=$crop.wavSha256; derivedPcmSha256=$crop.pcmSha256; conditioningSource=$crop.conditioningSource; croppedVoiceParity=$crop.croppedVoiceParity; stages=$stages}
}
$details | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $scratch 'clip-generation.json') -Encoding utf8
[ordered]@{result='COMPLETE'; processElapsedSeconds=$timer.Elapsed.TotalSeconds; generatedIds=@($remaining.id); retainedFirstMp3Sha256=(Hash (Join-Path $projectRoot 'public\audio\excuse-01.mp3')); sourceReferenceSha256=(Hash $ReferencePath)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $scratch 'live-crop-attempt.json') -Encoding utf8
Write-Output 'Native live cropped bank completed; run prepare.ps1 -Stage encode.'
