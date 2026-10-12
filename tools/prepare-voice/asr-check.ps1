param(
    [Parameter(Mandatory = $true)][string]$WhisperRoot,
    [Parameter(Mandatory = $true)][string]$NativeRuntime,
    [string]$ExtraMp3Path,
    [string]$ExtraExpectedText,
    [string[]]$ClipIds,
    [switch]$OnlyExtra
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$scratch = Join-Path $projectRoot '.for-ai-local\voice-preparation'
$asr = Join-Path $NativeRuntime 'secret-tunnel-asr.exe'
if ((Get-FileHash -LiteralPath $asr -Algorithm SHA256).Hash.ToLowerInvariant() -ne '26080b632a6d24e77fb67e88af2f40e52a36e93eef3d43a0ccddaba6a3d96204') { throw 'Unexpected local ASR binary.' }
$clips = @()
if (-not $OnlyExtra) {
    $clips = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'clips.json') -Raw | ConvertFrom-Json)
    if ($ClipIds) {
        $clips = @($clips | Where-Object { $_.id -in $ClipIds })
        if ($clips.Count -ne $ClipIds.Count) { throw 'Unknown requested clip ID.' }
    }
    foreach ($clip in $clips) {
        $clip | Add-Member -NotePropertyName mp3 -NotePropertyValue (Join-Path $projectRoot ('public\audio\' + $clip.id + '.mp3'))
    }
}
if ($ExtraMp3Path) {
    $ffmpeg = Join-Path $NativeRuntime 'ffmpeg.exe'
    if ((Get-FileHash -LiteralPath $ffmpeg -Algorithm SHA256).Hash.ToLowerInvariant() -ne '1403b8a8a70054f1b8659e3481156e12b3cdb9d99ddc3c2a33b556e50db1e039') { throw 'Unexpected FFmpeg binary.' }
    $extraId = [IO.Path]::GetFileNameWithoutExtension($ExtraMp3Path)
    $extraDecoded = Join-Path $scratch ($extraId + '.decoded.wav')
    & $ffmpeg -hide_banner -loglevel error -y -i $ExtraMp3Path -ac 1 -ar 24000 -codec:a pcm_s16le $extraDecoded
    if ($LASTEXITCODE -ne 0) { throw 'Extra MP3 decoding failed.' }
    $clips = @([pscustomobject]@{id=$extraId; text=$ExtraExpectedText; mp3=$ExtraMp3Path}) + $clips
} elseif ($OnlyExtra) { throw 'OnlyExtra requires ExtraMp3Path.' }
$results = @()
foreach ($clip in $clips) {
    # The encode stage made this WAV by decoding the actual published MP3.
    $decoded = Join-Path $scratch ($clip.id + '.decoded.wav')
    if (-not (Test-Path -LiteralPath $decoded)) { throw ('Run the MP3 encode stage first: ' + $clip.id) }
    $stdout = Join-Path $scratch ($clip.id + '.asr.jsonl')
    $stderr = Join-Path $scratch ($clip.id + '.asr.log')
    & $asr $WhisperRoot $decoded de 2> $stderr | Tee-Object -FilePath $stdout
    if ($LASTEXITCODE -ne 0) { throw ('Local ASR failed: ' + $clip.id) }
    $json = @(Get-Content -LiteralPath $stdout | Where-Object { $_.StartsWith('{') })
    if ($json.Count -ne 1) { throw ('Unexpected local ASR output: ' + $clip.id) }
    $recognized = $json[0] | ConvertFrom-Json
    $normalize = { param([string]$Text) (($Text.ToLowerInvariant() -replace '[^\p{L}\p{N}\s]', '') -replace '\s+', ' ').Trim() }
    $results += [ordered]@{
        id = $clip.id
        expected = $clip.text
        recognized = $recognized.transcript
        normalizedExactMatch = (& $normalize $clip.text) -eq (& $normalize $recognized.transcript)
        processedSamples = $recognized.processed_samples
        durationSeconds = $recognized.audio_duration_s
        mp3Sha256 = (Get-FileHash -LiteralPath $clip.mp3 -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
[ordered]@{
    method = 'Installed local Whisper large-v3-turbo q4_0; German; serial ASR of PCM decoded from final MP3s'
    asrBinarySha256 = (Get-FileHash -LiteralPath $asr -Algorithm SHA256).Hash.ToLowerInvariant()
    whisperModelSha256 = (Get-FileHash -LiteralPath (Join-Path $WhisperRoot 'whisper-large-v3-turbo-q4_0.gguf') -Algorithm SHA256).Hash.ToLowerInvariant()
    listening = 'NOT RUN: text recognition does not establish voice identity or subjective quality'
    clips = $results
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $scratch $(if ($OnlyExtra) { $extraId + '.asr-check.json' } else { 'asr-check.json' })) -Encoding utf8
Write-Output ('ASR checks saved; normalized exact matches: ' + @($results | Where-Object normalizedExactMatch).Count + '/' + $clips.Count)
