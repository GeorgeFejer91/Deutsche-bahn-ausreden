# Decision log

Record only durable choices whose rationale future agents would otherwise have
to rediscover. Source and tests remain the authority for implementation facts.

## D-0001 — Minimal control plane before product scaffolding

- Date: 2026-10-12
- Status: Accepted
- Context: The project needs a predictable AI entrypoint without choosing an
  application stack or inventing product structure prematurely.
- Decision: Use a short root `AGENTS.md` that routes to a lowercase `for-ai/`
  control plane. Keep product output outside that folder and add project files,
  skills, and protocols only for current requirements.
- Consequences: New agents get a reliable map and readiness gates. The first
  product task must still choose the smallest suitable output structure.
- Supersedes: None

## D-0002 — Fixed voice, all-GitHub browser generation

- Date: 2026-10-12; status: Accepted.
- Decision: Reuse only GS Deutsche Bahn Durchsage, prepare conditioning offline,
  host all runtime assets on GitHub and generate arbitrary visitor text locally.
  Random excuses reuse matching pregenerated audio clips.
- Consequence: The speech backbone/decoder still require efficient browser
  qualification. Finite recordings alone cannot fulfill the goal.

## D-0003 — DB-style independent parody interface

- Date: 2026-10-12; status: Accepted.
- Decision: Follow bahn.de's visual language and route form, with independent
  start/destination/train inputs, editable excuse, random excuse and MP3 output.
  Keep a visible independent-parody label.
- Consequence: No official booking, login, payments or timetable features.

## D-0004 — Private bootstrap and real-runtime completion

- Date: 2026-10-12; status: Accepted.
- Decision: Initialize GeorgeFejer91/Deutsche-bahn-ausreden privately on main.
  Keep the app goal active until browser inference, voice quality, hosting and
  MP3 generation pass their real gates.
- Consequence: Pages eligibility is unverified. A push alone is not deployment.

## D-0005 — Verified static INT4 model mirror

- Date: 2026-10-12; status: Accepted.
- Decision: Mirror the pinned INT4 embedding/backbone/heads exports and FP32
  audio decoder as verified ordinary Git files, with shards at most 48 MiB.
  Preserve their bytes with Git attributes and record original and shard hashes
  in the model manifest. Runtime loading uses only the website's own origin.
- Consequence: The model package is 469,057,874 bytes. Offline fixed conditioning
  omits the browser reference encoder and ASR. Compression and shorter-reference
  voice quality remain subject to the real-runtime/listening gate in D-0004.

## D-0006 — Public GitHub Pages publication

- Date: 2026-10-12; status: Accepted.
- Context: The account plan rejected private Pages. The user explicitly replied
  “ok make public” after the code, model, fixed voice and clip disclosure was explained.
- Decision: Make the repository public and serve the verified prebuilt `gh-pages`
  branch through GitHub Pages. Main remains the source owner.
- Consequence: The publication boundary is now public. Deployment/file delivery
  and live browser/voice quality remain separate qualification gates.
- Supersedes: D-0004's private visibility for continued publication; its original
  bootstrap history and runtime completion gate remain valid.

## Record format

For later decisions, add one compact entry with:

- identifier and title;
- date and status (`Proposed`, `Accepted`, `Superseded`, or `Rejected`);
- context;
- decision;
- consequences;
- supersession link when applicable.

Do not rewrite accepted history to hide a changed direction. Add a superseding
decision and link both entries.
