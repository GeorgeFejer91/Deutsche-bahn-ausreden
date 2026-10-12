function Get-PcmDuration([string]$Path) {
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($Path))
    try {
        if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'RIFF') { throw 'Expected a RIFF WAV.' }
        $null = $reader.ReadUInt32()
        if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'WAVE') { throw 'Expected WAVE audio.' }
        $sampleRate = 0; $channels = 0; $bits = 0; $dataBytes = 0
        while ($reader.BaseStream.Position + 8 -le $reader.BaseStream.Length) {
            $chunk = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
            $size = $reader.ReadUInt32()
            $end = $reader.BaseStream.Position + $size
            if ($end -gt $reader.BaseStream.Length) { throw 'Truncated WAV chunk.' }
            if ($chunk -eq 'fmt ') {
                if ($size -lt 16 -or $reader.ReadUInt16() -ne 1) { throw 'Expected PCM WAV.' }
                $channels = $reader.ReadUInt16(); $sampleRate = $reader.ReadUInt32()
                $null = $reader.ReadUInt32(); $null = $reader.ReadUInt16(); $bits = $reader.ReadUInt16()
            } elseif ($chunk -eq 'data') { $dataBytes += $size }
            $reader.BaseStream.Position = $end + ($size % 2)
        }
        if ($sampleRate -ne 24000 -or $channels -ne 1 -or $bits -ne 16 -or $dataBytes -le 0 -or $dataBytes % 2 -ne 0) { throw 'Expected nonempty 24 kHz mono 16-bit decoded PCM.' }
        return $dataBytes / 48000.0
    } finally { $reader.Dispose() }
}
