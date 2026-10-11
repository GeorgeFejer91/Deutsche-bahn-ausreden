# Deutsche-bahn-ausreden

A browser-only German parody announcement generator using one fixed GS Deutsche Bahn Durchsage voice, custom routes and train numbers, and prerecorded random excuses.

This repository was initialized on 2026-10-12. Product structure is
intentionally not scaffolded until the first real deliverable selects it.

## Active goal

Enter a starting station, destination, train number and excuse; generate, play
and download one MP3 using only **GS Deutsche Bahn Durchsage**. A random-excuse
button reuses matching pregenerated audio. All inference and audio work run in
the browser, with the complete website/model/runtime hosted on GitHub.

Follow [bahn.de](https://www.bahn.de/)'s visual style with a visible independent
parody label. This is not an official Deutsche Bahn service.

The saved 38.3-second voice reference was found and its hash verified. Efficient
browser model export, voice quality, MP3 generation and deployment remain
unqualified. The saved profile still requires the speech backbone and decoder.

See [the project contract](for-ai/PROJECT.md) and
[acceptance gates](for-ai/VERIFICATION.md).

AI-agent project context starts at [`for-ai/README.md`](./for-ai/README.md).

Repository: https://github.com/GeorgeFejer91/Deutsche-bahn-ausreden
Visibility at initialization: private
