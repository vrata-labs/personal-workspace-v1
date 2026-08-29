# Personal Workspace v1

Local review candidate for the FEAT-032 owner-bound private workspace. This is an original compact creative studio, not the eight-seat warm-modern meeting candidate.

## Boundary

The repository owns one scene ID, `personal-workspace-v1`, and one review release, `0.1.0`. Human rights approval for public staging review was recorded on 2026-08-29; human visual acceptance remains pending. Nothing in this tree is current, production-active, or publication-ready.

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
manifest.json
```

## Local Pipeline

```bash
pnpm install
BLENDER_BIN=/path/to/blender pnpm build
pnpm test
pnpm validate
pnpm inspect
BLENDER_BIN=/path/to/blender pnpm verify:reproducibility
```

When `BLENDER_BIN` is unset, the scripts use the `blender` executable from `PATH`. If neither is available, they fail before modifying build outputs and explain how to configure Blender.

`pnpm build` authors the scene from scratch, saves the Blend, performs a separate saved-Blend review render, converts the four views with `cwebp -q 90`, exports twice from the same saved Blend, requires byte identity, and derives all hashes and metrics from the resulting files.

The visual acceptance boundary remains open. Rights permit public staging review and the uses listed in the release notice, but a later human visual gate is still required before production activation or final publication.
