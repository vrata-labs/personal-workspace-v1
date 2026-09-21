# Project Contract

- This repository owns only `personal-workspace-v1`.
- Historical rights approval on 2026-08-29 covers its recorded release bytes; it does not approve later assets or visual quality. Keep release status `review`, `isCurrent=false`, and `publicationReady=false` until the separate gates are resolved.
- Do not add uncleared third-party assets, branding, private references, credentials, or local paths to release files. Cleared photographic panoramas/PBR inputs are allowed with exact source/license/provenance and required rights approval; do not replace a realistic target with a cartoon to avoid asset clearance.
- Release directories are immutable once published and contain exactly `scene.json`, `scene.glb`, `preview.webp`, and `LICENSES.md`.
- Use Blender 4.5.12 LTS build `84afd5f785f7`; run `pnpm validate && pnpm test && pnpm inspect && pnpm verify:reproducibility` before proposing publication.

## Shared scene-quality workflow

- Before every new or resumed art task, read the [shared quality contract](https://github.com/vrata-labs/platform/blob/a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d/docs/scene-quality-contract.md) and fill the [task packet](https://github.com/vrata-labs/platform/blob/a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d/docs/scene-authoring-task-template.md). Record that revision and any later applicable shared feedback.
- Every recognizable object needs purpose, intended users/actions, believable construction/materials and support. Run User/Builder/Physics passes against final geometry and views. Passive/deferred props are valid without runtime interaction.
- Inherit realistic materials and photographic-quality distant surroundings from the accepted Warm Modern Meeting 0.3.3 benchmark. Inspect actual source/browser pairs, seated views and close-ups; self-calibrated PHASH/NCC, tags and loaded-state checks prove neither realism nor usefulness.
- Personal 0.3.0 was rejected by the user on 2026-09-19: `REWORK_REQUIRED`. Do not resume publication/approval bookkeeping as though only human confirmation were missing. Its immutable bytes remain historical evidence; scene corrections require a new version.
- Propagate general feedback into the common contract and all affected scene tasks before the next scene. Documentation-only updates do not require rebuilding unchanged scene binaries.
- 2026-09-20 shared feedback (Q8): review groups as arrangements left by real use, with photographic references, purposeful density/orientation, mutual support and retrieval access. Personal 0.4.0 books repeat a 120 mm pitch for roughly 36 mm spines: isolated props do not resemble a usable library. Correct in a new version; neither per-book floor contact nor random rotations close this defect.
