# Personal Workspace v1

Local review candidate for the FEAT-032 owner-bound private workspace. This is an original compact creative studio, not the eight-seat warm-modern meeting candidate.

## Boundary

The repository owns one scene ID, `personal-workspace-v1`, and three materialized immutable review releases: `0.1.0`, `0.1.1`, and the baked `0.2.0`. Human rights approval, local runtime verification, and technical visual regression checks have passed; human visual acceptance remains pending. Nothing in this tree is current, production-active, or publication-ready.

The historical source contract uses semantic Y-up coordinates. Release manifests use the explicit runtime adapter `x=x, y=y, z=-z` for the main spawn, owner seat, and `workspace-main` media surface. The separate `0.2.0` runtime-review input converts Blender horizontal camera FOV to runtime vertical FOV at 16:9 without modifying that historical contract.

## Layout

```text
source/scene-contract.json
source/author_scene.py
source/export_scene.py
source/export_baked_release_0_2_0.py
source/baked-lightmap-0.2.0.png
source/runtime-review-0.2.0.json
source/render_review.py
source/review-candidate.blend
source/review/{entry,workspace,reading,diagonal-overview}.webp
provenance/*.json
assets/scenes/personal-workspace-v1/0.1.0/
assets/scenes/personal-workspace-v1/0.1.1/
assets/scenes/personal-workspace-v1/0.2.0/
provenance/baked-lightmap-0.2.0.json
provenance/runtime-capture-0.2.0/
manifest.json
```

## Local Pipeline

```bash
pnpm install
pnpm build:metadata
pnpm validate:visual
pnpm test
pnpm validate
pnpm inspect
BLENDER_BIN=/path/to/blender pnpm verify:reproducibility
```

The `0.1.0` source contract, saved Blend, review imagery, generation ledger, release artifact ledger, and contract lock remain historical authoring evidence. `pnpm build:metadata` does not invoke Blender or rewrite that evidence: it reproducibly creates or verifies the metadata-only `0.1.1` release from immutable `0.1.0` shared artifacts, then refreshes only the root manifest and `provenance/metadata-release-0.1.1.json`.

`source/export_baked_release_0_2_0.py` derives the baked release in memory from the immutable saved Blend. It exports only visible Runtime meshes, leaves `architecture.window-glass` unbaked, and embeds `source/baked-lightmap-0.2.0.png` into the other 15 materials with intensity 4 and original emissive metadata. The immutable `0.2.0` file records and two-run GLB reproducibility result are bound in `provenance/baked-lightmap-0.2.0.json`; re-running `build:release` may only validate byte-identical output and must not replace the release directory.

Runtime parity captures and diagnostics are committed under `provenance/runtime-capture-0.2.0/`. `capture-binding.json` binds the exact release GLB and scene manifest, runtime-review input, platform capture implementation commit, runtime statistics, and capture records without claiming human acceptance. Machine-local scene-debug URLs were normalized to `local-capture/*`. The baked release `preview.webp` is the committed runtime-capture preview. `pnpm validate:visual` recalculates ImageMagick metrics from the committed PNGs, records the measurement version, and allows only the documented small absolute evidence tolerance while enforcing the unchanged final technical regression thresholds.

Published baked versions are listed explicitly in `PUBLISHED_BAKED_VERSIONS`. A future release appends to that list and to the manifest; it does not replace or hide `0.2.0`.

The pinned Blender reproducibility gate remains mandatory. `pnpm verify:reproducibility` requires `BLENDER_BIN`, verifies Blender 4.5.12 LTS build `84afd5f785f7` and its binary hash, exports the saved Blend twice through `source/export_scene.py`, and requires byte identity with the historical `0.1.0` GLB. It then materializes `0.1.1` twice and, after the real baked release exists, materializes `0.2.0` twice and compares all four generated files with each release.

The visual acceptance boundary remains open. Rights permit public staging review and the uses listed in the release notice, but a later human visual gate is still required before production activation or final publication.
