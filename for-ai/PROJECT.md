# Project contract

## Purpose

A browser-only German parody announcement generator using one fixed GS Deutsche Bahn Durchsage voice, custom routes and train numbers, and prerecorded random excuses.

## Primary goal

Build a German, visibly independent Deutsche Bahn parody website. Visitors
enter Startbahnhof, Zielbahnhof, Zugnummer and Ausrede, generate a fictional
announcement in the fixed GS Deutsche Bahn Durchsage voice, play it and download
one genuine MP3. The visual style follows https://www.bahn.de/.

Host the complete website, runtime libraries, speech-model weights, fixed voice
data and prerecorded clips on GitHub. Inference, audio assembly and MP3 encoding
run in the visitor's browser. No inference server, external model CDN, API key
or Secret Tunnel installation is required. Local build-time preparation is allowed.

## User workflow

1. Independently edit three labeled inputs: Startbahnhof, Zielbahnhof, Zugnummer.
2. Edit Ausrede, or select Zufällige Ausrede to choose matching pregenerated text
   and audio. Editing the selection invalidates the clip and uses custom text.
3. Generate the contextual announcement in the fixed voice. Random excuses reuse
   prerecorded audio rather than synthesizing the selected excuse again.
4. Assemble segments with natural boundaries, play and download the MP3 locally.

Arbitrary valid station names and excuses must work. A finite clip bank alone
does not fulfill the goal. No voice uploads, runtime cloning or voice selector.

## Fixed voice and source evidence

- Exact profile: GS Deutsche Bahn Durchsage.
- Verified ID: c90953352421463ebc9da45d8a916c47.
- Saved mono reference: 24,000 Hz; 38.3 seconds; 1,838,478 bytes.
- Reference SHA-256:
  7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c.
- The user requested reuse of this profile, assembled from five existing
  GermanySimulator train announcement clips. Preserve the original library.
- The saved profile contains WAV audio and metadata, not browser-ready voice
  tokens. Its saved reference_text is empty. A local German ASR pass produced a
  transcript; transcription is not evidence of generated voice quality.
- Generated speech has not been auditioned or qualified for this website.

Prepare conditioning once offline so visitors do not download the reference
audio encoder or speech-recognition model. Compare any shorter reference and
compressed model against the original before accepting it. Store derivative
assets in this project and leave the source profile unchanged.

## Interface contract

Follow bahn.de's restrained white/light gray surfaces, red accents, dark readable
sans-serif type and route-search form geometry. Keep a visible independent-parody
label. Use box-first Grid/Flex, locked Pretext measurement, visible keyboard focus,
reduced motion and outside-in stretch geometry for the bounded generator.
Preserve full text and readable controls. No internal scrollbars or inaccessible
clipping; reflow or measured pages handle excess content. Secret Tunnel's speech
textarea scroll exception does not apply to this page.

## Efficiency and browser qualification

The installed native backbone is 2,450,344,112 bytes and its audio tokenizer is
805,665,628 bytes; those are not a browser-ready static package. A fixed voice
still requires the speech backbone and audio decoder. Community browser/ONNX
projects are research inputs, not runtime qualification.

Enforce GitHub Pages' 1 GB site limit and ordinary-Git files below 100 MiB.
Shard weights if needed; verify final asset fetches/hashes and GitHub CORS rather
than assuming Releases assets can be fetched from Pages. Measure cold download,
cached startup, peak memory, generation time and output duration. Listen to real
German output for voice identity, station/digit intelligibility and natural joins.
Supported phone/browser matrix remains Undecided until measured.

## Non-goals

- No alternate voice, browser speechSynthesis substitute, inference backend,
  external model host, runtime cloning, account system or official DB service.
- No modification of SecretTunnel-v2, GermanySimulator or the source profile.
- No second implementation tree or duplicate source of truth.
- No capability claim without matching evidence.

Keep the original references and profile unchanged during asset preparation.

## Product/control-plane boundary

- Product source and deliverables: outside `for-ai/`; exact roots are
  **Undecided until the first deliverable selects them**.
- Agent orchestration and durable project memory: `for-ai/`.
- Local generated diagnostics and scratch evidence: `.for-ai-local/` (ignored).

## Architecture and ownership

- Target: static HTML, small JavaScript/TypeScript frontend and a speech worker.
  Framework and browser inference implementation remain Undecided.
- CSS Grid/Flex owns geometry; locked Pretext measures bounded text.
- Worker owns local model loading, inference, progress and cancellation.
- Audio assembly/MP3 encoding run locally in the browser.
- Repository: GeorgeFejer91/Deutsche-bahn-ausreden; private; main.
- GitHub Pages is the target. Private-repository deployment eligibility and
  the final efficient model package remain unverified.

## Current verified state

- Fresh Git repository initialized on 2026-10-12.
- AI control plane created and mechanically checked.
- Saved voice profile/reference hash and native model sizes were inspected.
- Local German ASR transcribed the complete 38.3-second reference.
- No product implementation has been scaffolded.
- Browser inference, voice audition, MP3 generation and Pages deployment have
  not passed their real runtime gates.

Git and runnable checks are the authority for branch, revision, and behavior.
Do not turn this section into a second status ledger.
