# Personal Workspace v1

Local review candidate for the FEAT-032 owner-bound private workspace. This is an original compact creative studio, not the eight-seat warm-modern meeting candidate.

## Boundary

The repository owns one scene ID, `personal-workspace-v1`, and two immutable review releases, `0.1.0` and `0.1.1`. Human rights approval for public staging review was recorded on 2026-08-29; human visual acceptance remains pending. Nothing in this tree is current, production-active, or publication-ready.

The source contract uses semantic Y-up coordinates. Release manifests use the explicit runtime adapter `x=x, y=y, z=-z` for the main spawn, owner seat, and `workspace-main` media surface.

## Layout

```text
source/scene-contract.json
source/author_scene.py
source/export_scene.py
source/render_review.py
source/review-candidate.blend
source/review/{entry,workspace,reading,diagonal-overview}.webp
provenance/*.json
assets/scenes/personal-workspace-v1/0.1.0/
assets/scenes/personal-workspace-v1/0.1.1/
manifest.json
```

## Local Pipeline

```bash
pnpm install
pnpm build
pnpm test
pnpm validate
pnpm inspect
BLENDER_BIN=/path/to/blender pnpm verify:reproducibility
```

The `0.1.0` source contract, saved Blend, review imagery, generation ledger, release artifact ledger, and contract lock remain historical authoring evidence. `pnpm build` does not invoke Blender or rewrite that evidence: it reproducibly creates or verifies the metadata-only `0.1.1` release from immutable `0.1.0` shared artifacts, then refreshes only the root manifest and `provenance/metadata-release-0.1.1.json`.

The pinned Blender reproducibility gate remains mandatory. `pnpm verify:reproducibility` requires `BLENDER_BIN`, verifies Blender 4.5.12 LTS build `84afd5f785f7` and its binary hash, exports the saved Blend twice through `source/export_scene.py`, and requires byte identity with the historical `0.1.0` GLB. It then materializes `0.1.1` twice and compares all four generated files with the release.

The visual acceptance boundary remains open. Rights permit public staging review and the uses listed in the release notice, but a later human visual gate is still required before production activation or final publication.
