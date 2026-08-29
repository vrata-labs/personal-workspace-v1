# Project Contract

- This repository owns only `personal-workspace-v1`.
- Human rights owner approval for public staging review was recorded on 2026-08-29. Keep release status `review`, visual acceptance `pending-human-acceptance`, `isCurrent=false`, and `publicationReady=false`; do not claim production activation or final publication approval.
- Do not add downloaded assets, branding, private references, credentials, or local paths to release files.
- Release directories are immutable once published and contain exactly `scene.json`, `scene.glb`, `preview.webp`, and `LICENSES.md`.
- Use Blender 4.5.12 LTS build `84afd5f785f7`; run `pnpm validate && pnpm test && pnpm inspect && pnpm verify:reproducibility` before proposing publication.
