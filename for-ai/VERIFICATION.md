# Verification and readiness gates

Evidence must match the claim. Missing dependencies, credentials, hardware, or
runtime access produce `BLOCKED` or `NOT RUN`, never `VERIFIED`.

## Result vocabulary

- `VERIFIED`: the named check directly observed the claimed surface and passed.
- `PARTIAL`: some required evidence passed and the missing scope is named.
- `BLOCKED`: a concrete external or authority blocker prevented the check.
- `NOT RUN`: the check was intentionally not applicable or not attempted, with
  the reason stated.

## Gate 0: bootstrap readiness

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File for-ai/scripts/check-context.ps1 -ProjectRoot . -RequireRemote
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Pass when the context checker succeeds, the intended tree is clean, and local
`HEAD` equals `origin/main`.

## Gate 1: task contract

Before implementation, name:

- the observable user outcome;
- affected product surface and owner;
- acceptance criteria;
- focused check that can fail for the requested behavior;
- broader checks required by affected boundaries;
- explicitly deferred work.

## Gate 2: focused change

Run the narrowest real check for the change. A syntax check proves syntax; a unit test proves
its tested logic; neither proves UI, deployment, hardware, performance, safety,
or scientific validity unless it directly observes that surface.

```sh
pnpm test
pnpm verify:assets
pnpm build
pnpm dev
```

The Node checks cover preserved Unicode/leading train zeroes, complete grapheme
paging and real MP3 frame encoding from PCM. They do not mock model inference.
The build enforces the site/file size limits, cleans only its checked `dist/`
path and copies all local ORT runtime variants plus the separate LAME module.
The asset verifier checks every shard and reconstructed model hash. Git
attributes preserve model bytes; compare the index/committed blobs with verified
working files before publishing binary artifacts across Windows/Linux.
Use the real browser UI to qualify inference, playback, download and geometry.
Inspect both Pretext results and nested DOM bounds: labels can fit while groups
overlap. Require `data-text-fit=fit` and `data-geometry-fit=fit`, screenshots,
reachable controls and no document/textarea overflow at supported sizes.
Custom word spacing uses matching DOM measurements; report that separately
from Pretext parity. CSS viewport frames qualify reflow, not phone hardware or
actual browser zoom. Record unavailable browser controls as NOT RUN.

## Gate 3: integrated readiness

Run proportionate build, test, lint, type, runtime, visual, device, security,
and compatibility checks for every affected boundary. Do not run an expensive
or irrelevant full matrix for a documentation-only edit.

Browser speech qualification requires:

1. Preserve/verify the original profile hash; prepare reusable voice conditioning
   offline and record derivative hashes and exact model/license provenance.
2. Enforce full package below GitHub Pages' 1 GB limit and ordinary Git files
   below 100 MiB. Verify actual browser requests to final GitHub asset URLs.
3. Generate previously unseen German station/train/excuse text in a real browser.
   Record browser/GPU, cold download, cached startup, peak memory, generation time
   and output duration. Cached assets must still generate novel text.
4. Verify no inference server, text/audio upload, external CDN, runtime cloning
   encoder or ASR model. Only the fixed GS Deutsche Bahn Durchsage voice is used.
5. Check random excuses use matching prerecorded text/audio; editing invalidates
   that selection. Verify complete assembled playback and a decodable MP3.
6. Listen to real German outputs for voice identity, words/digits and natural
   joins. ASR assists but does not replace audition. Define phone support only
   after real device testing; expose unsupported runtime failures honestly.
7. Check rendered minimum/normal/large desktop, phone portrait/landscape, 320 CSS
   px reflow, 200% zoom and text-spacing overrides. Review screenshots, focus,
   full labels, bounds and Pretext/DOM parity. Concealed overflow is a failure.

Add exact preparation/build/runtime commands when implemented. A UI build never
qualifies browser speech generation or generated-audio quality.

## Gate 4: publication

1. Review status and diff; preserve unrelated changes.
2. Confirm only intended paths are staged.
3. Confirm all required gates passed or are honestly reported.
4. Create one coherent commit under normal repository policy.
5. Push without force and without bypassing protection or secret scanning.
6. Verify the remote commit and required CI/deployment for that exact SHA.

The new repository is initially private. Preserve that visibility unless the
user authorizes otherwise; verify private Pages eligibility before deployment.

## Handoff evidence

Report exact commands or observed surfaces, results, untested scope, commit SHA,
remote synchronization, CI/deployment state, and whether `for-ai/` changed.
