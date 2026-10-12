param([Parameter(Mandatory = $true)][string]$FfmpegPath)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $PSScriptRoot 'wave-duration.ps1')
$verifyScratch = Join-Path $projectRoot '.for-ai-local\voice-preparation'
New-Item -ItemType Directory -Force -Path $verifyScratch | Out-Null
$expectedReference = '7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c'
$voicePath = Join-Path $projectRoot 'public\voice\gs-deutsche-bahn-durchsage.json'
$voice = Get-Content -LiteralPath $voicePath -Raw | ConvertFrom-Json
if ($voice.profileId -ne 'c90953352421463ebc9da45d8a916c47' -or $voice.referenceSha256 -ne $expectedReference -or $voice.sampleRate -ne 24000 -or $voice.referenceSeconds -ne 38.3) { throw 'Wrong fixed voice identity or reference.' }
if ($voice.refText -ne (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'reference-transcript.txt') -Raw).Trim()) { throw 'Conditioning transcript drifted.' }
if ($voice.refRms -le 0 -or [double]::IsNaN($voice.refRms) -or [double]::IsInfinity($voice.refRms)) { throw 'Invalid reference RMS.' }
if ($voice.refAudioTokens.Count -ne 8) { throw 'Expected eight conditioning codebooks.' }
foreach ($row in $voice.refAudioTokens) {
    if ($row.Count -ne 957) { throw 'Wrong reference frame count.' }
    foreach ($token in $row) { if ($token -lt 0 -or $token -gt 1023 -or $token -ne [Math]::Truncate($token)) { throw 'Invalid reference audio token.' } }
}
$candidateDefinitions = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'reduced-candidates.json') -Raw | ConvertFrom-Json
foreach ($id in @('4s','9s')) {
    $candidatePath = Join-Path $projectRoot ('public\voice\gs-deutsche-bahn-durchsage-' + $id + '.json')
    $candidate = Get-Content -LiteralPath $candidatePath -Raw | ConvertFrom-Json
    $definition = $candidateDefinitions.$id
    $seconds = $definition.endSeconds - $definition.startSeconds
    if ($candidate.profileId -ne $voice.profileId -or $candidate.referenceSha256 -ne $expectedReference -or $candidate.referenceSeconds -ne 38.3 -or $candidate.refText -ne $definition.refText -or $candidate.conditioningSeconds -ne $seconds -or $candidate.conditioningFrames -ne $seconds*25 -or $candidate.refAudioTokens.Count -ne 8) { throw ('Invalid reduced voice candidate: ' + $id) }
    if ($candidate.conditioningSource.startSeconds -ne $definition.startSeconds -or $candidate.conditioningSource.endSeconds -ne $definition.endSeconds -or $candidate.conditioningSource.sampleCount -ne $seconds*24000 -or $candidate.conditioningSource.sourceReferenceSha256 -ne $expectedReference -or $candidate.conditioningSource.originalCue.sha256 -ne $definition.originalCue.sha256) { throw ('Invalid candidate crop provenance: ' + $id) }
    if ($candidate.refRms -le 0 -or [double]::IsNaN($candidate.refRms) -or [double]::IsInfinity($candidate.refRms)) { throw ('Invalid candidate RMS: ' + $id) }
    foreach ($row in $candidate.refAudioTokens) {
        if ($row.Count -ne $seconds*25) { throw ('Wrong candidate frame count: ' + $id) }
        foreach ($token in $row) { if ($token -lt 0 -or $token -gt 1023 -or $token -ne [Math]::Truncate($token)) { throw ('Invalid candidate audio token: ' + $id) } }
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'public\audio\excuses.json') -Raw | ConvertFrom-Json
$sourceClips = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'clips.json') -Raw | ConvertFrom-Json
if ($manifest.excuses.Count -ne 5 -or $manifest.profileId -ne $voice.profileId -or $manifest.referenceSha256 -ne $expectedReference) { throw 'Invalid fixed audio manifest.' }
$clips = @($manifest.excuses) + @($manifest.closing)
if ($clips.Count -ne 6 -or @($clips.id | Select-Object -Unique).Count -ne 6) { throw 'Expected six distinct clips.' }
foreach ($clip in $clips) {
    $source = @($sourceClips | Where-Object { $_.id -eq $clip.id })
    if ($source.Count -ne 1 -or $clip.text -ne $source[0].text -or $clip.url -ne ('audio/' + $clip.id + '.mp3')) { throw 'Clip/text mapping drifted.' }
    $mp3 = Join-Path $projectRoot ('public\' + $clip.url)
    if ((Get-FileHash -LiteralPath $mp3 -Algorithm SHA256).Hash.ToLowerInvariant() -ne $clip.sha256) { throw ('Clip hash mismatch: ' + $clip.id) }
    $decoded = Join-Path $verifyScratch ($clip.id + '.verified.wav')
    & $FfmpegPath -hide_banner -loglevel error -y -i $mp3 -ac 1 -ar 24000 -codec:a pcm_s16le $decoded
    if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $mp3).Length -ne $clip.bytes -or $clip.durationSeconds -lt 0.5 -or [Math]::Abs((Get-PcmDuration $decoded) - $clip.durationSeconds) -gt 0.0001) { throw ('Invalid MP3: ' + $clip.id) }
}
$publicFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'public\voice'), (Join-Path $projectRoot 'public\audio') -File -Recurse)
if (@($publicFiles | Where-Object { $_.Extension -eq '.wav' -or $_.Length -ge 100MB }).Count -gt 0) { throw 'Private reference or oversized file in public assets.' }
[ordered]@{ result = 'VERIFIED'; voiceSha256 = (Get-FileHash -LiteralPath $voicePath -Algorithm SHA256).Hash.ToLowerInvariant(); conditioningShape = @(8,957); candidateShapes=@(@(8,100),@(8,225)); referenceSeconds = 38.3; conditioningSeconds = 38.28; mp3Count = 6; publicAssetBytes = ($publicFiles | Measure-Object Length -Sum).Sum; listening = 'NOT RUN'; browserInference = 'NOT RUN' } | ConvertTo-Json
