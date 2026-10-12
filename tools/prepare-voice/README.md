# Offline fixed voice preparation

`prepare.ps1` creates fixed reference conditioning and six real native OmniVoice
clips. Only the conditioning JSON and MP3s ship to the browser. The source WAV,
native executable, audio encoder and ASR model are not part of the website.

```powershell
pwsh -NoProfile -File tools/prepare-voice/prepare.ps1 `
  -ModelRoot '<installed OmniVoice directory>' `
  -ReferencePath '<saved GS Deutsche Bahn Durchsage reference.wav>' `
  -NativeRuntime '<directory containing pinned omnivoice-cli.exe and ffmpeg.exe>'
```

The helper pins the public Rust library to revision
`4c7b088294fd6f3a5fb9e3b1dfd3a77bc12f105b`. Cargo.lock locks its dependencies.
The audio preparation verifies the SHA-256 of the existing patched native CLI
and FFmpeg before using them. The generated manifest records those hashes,
patch provenance, model hashes, text, seed, timing, lengths and derivative hashes.

The source reference must match SHA-256
`7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c` and contain
919,200 mono samples at 24 kHz. No VAD or long-reference shortening runs.
Native codec alignment uses 957 complete 960-sample hops: 38.28 seconds of the
38.3-second reference. The original file remains unchanged. Native RMS behavior
is retained, including amplification only when the reference RMS is below 0.1.
`reference-transcript.txt` is the offline German ASR transcript of that saved
reference; spelling uncertainty in its proper names has not been independently
auditioned or edited. It is explicitly provided to inference, so clip generation
does not run ASR.

Generated WAVs and logs stay under ignored `.for-ai-local/voice-preparation/`.
`-Stage conditioning` or `-Stage audio` runs either part independently;
`-Stage encode` encodes and validates already completed native WAVs without
repeating synthesis. Native stage timings remain available in that case. The public
audio manifest pairs each MP3 with its exact text. These files prove native audio
generation and MP3 decodability; voice identity, pronunciation and joins still
require listening, and browser inference requires its own qualification.

Check the completed derivative assets with:

```powershell
pwsh -NoProfile -File tools/prepare-voice/verify.ps1 -FfmpegPath '<pinned ffmpeg.exe>'
```

This verifies reference identity, conditioning shape/range/RMS, transcript,
five excuses plus the closing clip, exact text/audio mapping, hashes and real
MP3 decoding. It also rejects a public WAV or an asset at least 100 MiB in size.

After synthesis and encoding finish, `asr-check.ps1 -WhisperRoot '<installed
whisper directory>' -NativeRuntime '<pinned runtime directory>'` runs the existing
local German ASR serially on WAVs decoded from the final MP3s. It retains exact
expected and recognized text in the ignored preparation directory. Text matching
is evidence of intelligibility; it does not establish voice identity or replace
listening. The encode stage retains the already verified first MP3 unchanged.

For the qualified cropped native bank after conditioning has been prepared:

```powershell
pwsh -NoProfile -File tools/prepare-voice/live-crop-generate.ps1 `
  -ModelRoot '<installed OmniVoice directory>' `
  -ReferencePath '<saved GS Deutsche Bahn Durchsage reference.wav>' `
  -NativeRuntime '<directory containing pinned omnivoice-cli.exe and ffmpeg.exe>'
# Then run prepare.ps1 with the same arguments and -Stage encode.
```

The script creates an ignored 4-second float32 WAV from saved-reference offsets
6–10 seconds. It checks all 96,000 decoded PCM samples against the exact hash
already recorded in the 4s conditioning JSON. The five remaining clips use the
native `infer-batch` live CUDA path, with one worker, 32 steps, seed 20261012,
guidance 2, layer penalty 5, time shift 0.1, position temperature 5 and class
temperature 0. Reference preprocessing is off; postprocessing is on. The original
full-reference first clip is retained unchanged. Per-clip stage logs and final
manifest record the actual method, settings, crop source and hashes. The complete
five-clip native process took 55.505 seconds in this run. All six final MP3s
decoded correctly and their local German ASR transcripts matched the intended
sentences. Listening and cropped voice identity parity remain pending.

The `cached-clips` Rust helper also prepares native fixtures from the hash-pinned
full/4s/9s conditioning, exercises the native artifact reader round trip, and
decodes existing native tokens on CPU. `cached-generate.ps1` is retained as an
unqualified experiment: its stage0 path produced no completed token output in
the observed runs. The full cached run was deliberately stopped at 1,040.986
seconds under substantial paging. The cropped cached run later disappeared
during an inactive agent interval; its final elapsed time and exit cause are
unknown. Ignored `cached-full-attempt.json` and `cached-4s-attempt.json` preserve
these limits, and separate full/cropped fixtures remain available. The host
`run_loop` wrapper delegates to `run_loop_device`; the wrapper alone is not a
confirmed cause of the anomalous duration. Use the completed live bank path above.

Two separately qualified shorter conditioning candidates can be prepared with
`prepare-fixed-voice MODEL_ROOT ORIGINAL_REFERENCE OUTPUT_JSON 4s` or `9s`.
They select saved-reference offsets 6–10 seconds and 10–19 seconds respectively.
The source receipt, authored German source text, timed subtitle cues and actual
source MP3 hashes confirm the excerpts; `reduced-candidates.json` records those
authorities. No new fade, VAD or source edit runs. The public JSON retains the
original profile/reference identity and 38.3-second source duration while
`conditioningSource` records exact crop bounds, sample count and a hash of the
decoded float32 PCM samples. `conditioningFrames` and `conditioningSeconds`
describe the actual candidate. The full JSON remains available for comparison.
These candidate files do not establish voice identity or intelligibility parity.

Upstream references: [OmniVoice Rust source](https://github.com/FerrisMind/omnivoice-rs/tree/4c7b088294fd6f3a5fb9e3b1dfd3a77bc12f105b),
[OmniVoice model](https://huggingface.co/k2-fsa/OmniVoice/tree/c5fdb5ccb189668d56333f77ba2629f4cd7535f4).
