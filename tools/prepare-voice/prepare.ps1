param(
    [Parameter(Mandatory = $true)][string]$ModelRoot,
    [Parameter(Mandatory = $true)][string]$ReferencePath,
    [Parameter(Mandatory = $true)][string]$NativeRuntime,
    [ValidateSet('all', 'conditioning', 'audio', 'encode')][string]$Stage = 'all'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scratch = Join-Path $projectRoot '.for-ai-local\voice-preparation'
$voiceOutput = Join-Path $projectRoot 'public\voice'
$audioOutput = Join-Path $projectRoot 'public\audio'
$expectedReference = '7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c'
. (Join-Path $PSScriptRoot 'wave-duration.ps1')
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function CheckExit([string]$Action) { if ($LASTEXITCODE -ne 0) { throw "$Action failed: exit $LASTEXITCODE" } }
if ((Hash $ReferencePath) -ne $expectedReference) { throw 'Unexpected voice reference hash.' }
New-Item -ItemType Directory -Force -Path $scratch, $voiceOutput, $audioOutput | Out-Null
$transcript = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'reference-transcript.txt') -Raw).Trim()

if ($Stage -in @('all', 'conditioning')) {
    & cargo run --release --locked --manifest-path (Join-Path $PSScriptRoot 'Cargo.toml') -- $ModelRoot $ReferencePath (Join-Path $voiceOutput 'gs-deutsche-bahn-durchsage.json')
    CheckExit 'Fixed conditioning preparation'
}
if ($Stage -in @('all', 'audio', 'encode')) {
    $cli = Join-Path $NativeRuntime 'omnivoice-cli.exe'
    $ffmpeg = Join-Path $NativeRuntime 'ffmpeg.exe'
    if ((Hash $cli) -ne 'd0f39af9d5b74e114c95e01dd30b43b78b8c9ac0735ec613c716d079095ff17b') { throw 'Unexpected native inference binary.' }
    if ((Hash $ffmpeg) -ne '1403b8a8a70054f1b8659e3481156e12b3cdb9d99ddc3c2a33b556e50db1e039') { throw 'Unexpected FFmpeg binary.' }
    $clips = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'clips.json') -Raw | ConvertFrom-Json
    $rows = $clips | ForEach-Object { [ordered]@{ id = $_.id; text = $_.text; ref_audio = $ReferencePath; ref_text = $transcript; language_id = 'de' } | ConvertTo-Json -Compress }
    $testList = Join-Path $scratch 'clips.jsonl'
    [IO.File]::WriteAllLines($testList, $rows, [Text.UTF8Encoding]::new($false))
    $priorAudioCpu = $env:OMNIVOICE_AUDIO_CPU
    $priorStageTime = $env:OMNIVOICE_STAGE_TIME
    $env:OMNIVOICE_AUDIO_CPU = '1'
    $env:OMNIVOICE_STAGE_TIME = '1'
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        if ($Stage -ne 'encode') {
        & $cli infer-batch --model $ModelRoot --test-list $testList --res-dir $scratch --device cuda:0 --dtype f16 --batch-size 1 --nj-per-gpu 1 --warmup 0 --preprocess-prompt false --postprocess-output true --num-step 32 --seed 20261012 2>&1 | Tee-Object -FilePath (Join-Path $scratch 'native-generation.log')
        CheckExit 'Native fixed-voice generation'
        }
    } finally {
        $env:OMNIVOICE_AUDIO_CPU = $priorAudioCpu
        $env:OMNIVOICE_STAGE_TIME = $priorStageTime
    }
    $timer.Stop()
    $records = @()
    $generationDetails = @()
    $generationDetailsPath = Join-Path $scratch 'clip-generation.json'
    if ($Stage -eq 'encode' -and (Test-Path -LiteralPath $generationDetailsPath)) { $generationDetails = @(Get-Content -LiteralPath $generationDetailsPath -Raw | ConvertFrom-Json) }
    foreach ($clip in $clips) {
        $wav = Join-Path $scratch ($clip.id + '.wav')
        $mp3 = Join-Path $audioOutput ($clip.id + '.mp3')
        if ($clip.id -eq 'excuse-01' -and (Test-Path -LiteralPath $mp3)) {
            if ((Hash $mp3) -ne '7a5fac531aba2e46eab549ab0667f206341439614d40b013791c95d0140d646e') { throw 'Retained first MP3 changed.' }
        } else {
            & $ffmpeg -hide_banner -loglevel error -y -i $wav -ac 1 -ar 24000 -codec:a libmp3lame -b:a 96k -map_metadata -1 $mp3
            CheckExit ('MP3 encoding ' + $clip.id)
        }
        $decoded = Join-Path $scratch ($clip.id + '.decoded.wav')
        & $ffmpeg -hide_banner -loglevel error -y -i $mp3 -ac 1 -ar 24000 -codec:a pcm_s16le $decoded
        CheckExit ('MP3 decoding ' + $clip.id)
        $seconds = Get-PcmDuration $decoded
        if ($seconds -lt 0.5 -or $seconds -gt 30) { throw ('Unexpected clip duration: ' + $clip.id) }
        $detail = @($generationDetails | Where-Object { $_.id -eq $clip.id })
        $method = $(if ($detail.Count) { $detail[0] } else { [ordered]@{ method='native infer-batch with complete reference'; seed=20261012; positionTemperature=5; numStep=32 } })
        $records += [ordered]@{ id = $clip.id; text = $clip.text; url = ('audio/' + $clip.id + '.mp3'); sha256 = (Hash $mp3); wavSha256 = (Hash $wav); durationSeconds = $seconds; bytes = (Get-Item -LiteralPath $mp3).Length; generation = $method }
    }
    [ordered]@{
        excuses = @($records | Where-Object { $_.id -ne 'closing' })
        closing = @($records | Where-Object { $_.id -eq 'closing' })[0]
        voice = 'GS Deutsche Bahn Durchsage'
        profileId = 'c90953352421463ebc9da45d8a916c47'
        referenceSha256 = $expectedReference
        sampleRate = 24000
        provenance = [ordered]@{
            nativeBinarySha256 = (Hash $cli)
            nativeLibraryRevision = '4c7b088294fd6f3a5fb9e3b1dfd3a77bc12f105b'
            nativePatchHashes = [ordered]@{
                cuda = '06e70947845a9fd56bf869d36ff4bf02131e11e789ba753e069f4e33ebf328e1'
                longPrompt = 'de7a82a6a7b1ae5ddb9f2762008b95aa33984a35bf86f9615ba2588606262289'
                asr = '5549334ce21d513755566b0030712648e8b1475e5d94e5a965fa1193cca185cf'
                mixed = 'c5ba065380a16bb02c4b0c4caae6e79a84385ee56d0c022ce40ea0e5605c5559'
            }
            modelRepository = 'k2-fsa/OmniVoice'
            modelRevision = 'c5fdb5ccb189668d56333f77ba2629f4cd7535f4'
            modelSha256 = (Hash (Join-Path $ModelRoot 'model.safetensors'))
            audioTokenizerSha256 = (Hash (Join-Path $ModelRoot 'audio_tokenizer\model.safetensors'))
            ffmpegSha256 = (Hash $ffmpeg)
            generatorDevice = 'CUDA 0 / FP16; audio codec CPU / FP32'
            numStep = 32
            preprocessPrompt = $false
            postprocessOutput = $true
            generationSeconds = $(if ($Stage -ne 'encode') { $timer.Elapsed.TotalSeconds } else { $null })
            initialBatchAttempt = $(if (Test-Path -LiteralPath (Join-Path $scratch 'native-attempt.json')) { Get-Content -LiteralPath (Join-Path $scratch 'native-attempt.json') -Raw | ConvertFrom-Json } else { $null })
            mp3Encoding = 'libmp3lame, 96 kbps, 24 kHz, mono'
            decodability = 'VERIFIED: all MP3s decoded to nonempty 24 kHz mono PCM with FFmpeg'
            listening = 'NOT RUN: no human or audio-input audition; ASR does not qualify voice identity'
        }
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $audioOutput 'excuses.json') -Encoding utf8
}
if ((Hash $ReferencePath) -ne $expectedReference) { throw 'Source reference changed during preparation.' }
