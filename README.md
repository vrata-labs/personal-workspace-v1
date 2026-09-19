# Personal Workspace v1

Local review candidate for the FEAT-032 owner-bound private workspace. This is an original compact creative studio, not the eight-seat warm-modern meeting candidate.

## Boundary

The repository owns one scene ID, `personal-workspace-v1`, and four materialized immutable review releases: `0.1.0`, `0.1.1`, the baked `0.2.0`, and the derived-environment review release `0.3.0`. Historical public-staging rights apply only to the exact `0.1.x` and `0.2.0` bytes. The `0.3.0` technical runtime capture has passed, while exact-byte rights review and human visual acceptance remain pending. Nothing in this tree is current, production-active, or publication-ready.

The historical source contract uses semantic Y-up coordinates. Release manifests use the explicit runtime adapter `x=x, y=y, z=-z` for the main spawn, owner seat, and `workspace-main` media surface. The separate `0.2.0` runtime-review input and versioned `0.3.0` visual-parity config convert Blender horizontal camera FOV to runtime vertical FOV at 16:9 without modifying that historical contract.

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
source/release-acceptance-index.json
source/releases/0.3.0/{review-scene.blend,panorama-city-park.jpg}
source/releases/0.3.0/{generate-panorama,prepare-scene,export-release,render-review}.py
source/releases/0.3.0/{scene-manifest,scene-reality,user-scenarios}.json
source/releases/0.3.0/{review-source-lock,visual-parity-config}.json
source/releases/0.3.0/review/*.webp
provenance/*.json
provenance/releases/0.3.0/*
provenance/runtime-capture-0.3.0/{run-1,run-2,run-3}/
assets/scenes/personal-workspace-v1/0.1.0/
assets/scenes/personal-workspace-v1/0.1.1/
assets/scenes/personal-workspace-v1/0.2.0/
assets/scenes/personal-workspace-v1/0.3.0/
provenance/baked-lightmap-0.2.0.json
provenance/runtime-capture-0.2.0/
manifest.json
```

## Local Pipeline

```bash
pnpm install
pnpm build:metadata
BLENDER_BIN=/path/to/blender pnpm build:release
pnpm validate:visual
pnpm test
pnpm validate
pnpm inspect
BLENDER_BIN=/path/to/blender pnpm verify:reproducibility
```

The `0.1.0` source contract, saved Blend, review imagery, generation ledger, release artifact ledger, and contract lock remain historical authoring evidence. `pnpm build:metadata` does not invoke Blender or rewrite that evidence: it reproducibly creates or verifies the metadata-only `0.1.1` release from immutable `0.1.0` shared artifacts, then refreshes only the root manifest and `provenance/metadata-release-0.1.1.json`.

`source/export_baked_release_0_2_0.py` derives the baked release in memory from the immutable saved Blend. It exports only visible Runtime meshes, leaves `architecture.window-glass` unbaked, and embeds `source/baked-lightmap-0.2.0.png` into the other 15 materials with intensity 4 and original emissive metadata. The immutable `0.2.0` file records and two-run GLB reproducibility result are bound in `provenance/baked-lightmap-0.2.0.json`; re-running `build:release` may only validate byte-identical output and must not replace the release directory.

Runtime parity captures and diagnostics are committed under `provenance/runtime-capture-0.2.0/`. `capture-binding.json` binds the exact release GLB and scene manifest, runtime-review input, platform capture implementation commit, runtime statistics, and capture records without claiming human acceptance. Machine-local scene-debug URLs were normalized to `local-capture/*`. The baked release `preview.webp` is the committed runtime-capture preview. `pnpm validate:visual` recalculates ImageMagick metrics from the committed PNGs, records the measurement version, and allows only the documented small absolute evidence tolerance while enforcing the unchanged final technical regression thresholds.

The `0.3.0` source is isolated under `source/releases/0.3.0/`. It adds only project-authored deterministic panorama pixels and an inward-facing panorama sphere to a derived Blend while preserving the `0.2.0` runtime bindings and baked-lighting inputs. The accepted saved Blend is locked by exact bytes; byte-identical reauthoring of that Blend container is not claimed. Two-run reproducibility applies to panorama pixels before JPEG encoding and to GLB export from the accepted saved Blend. Seven fixed source-review views are locked by `review-source-lock.json`; they remain evidence for human review rather than a human acceptance decision. Three complete version-bound runtime capture sets are committed under `provenance/runtime-capture-0.3.0/`; all corresponding PNG bytes are identical across runs. The versioned visual config records thresholds calibrated only from those three sets with explicit PHASH and NCC margins, and `pnpm validate:visual` recalculates historical `0.2.0` parity before rechecking every `0.3.0` binding, runtime diagnostic, capture byte, stability comparison, and source-to-runtime metric.

Append-only release history and versioned source/provenance directories are protected by validation and CI. A future release appends a new version; it does not replace, hide, or rewrite an existing release.

The pinned Blender reproducibility gate remains mandatory. `pnpm verify:reproducibility` requires `BLENDER_BIN`, verifies Blender 4.5.12 LTS build `84afd5f785f7` and its binary hash, reproduces the historical `0.1.0`, metadata-only `0.1.1`, and baked `0.2.0` releases, then reproduces the `0.3.0` GLB and decoded panorama pixels twice while verifying the exact hash-bound manifest, preview, and license inputs. Review WebP encoder bytes are not claimed reproducible.

The visual acceptance boundary remains open for every release. The exact `0.3.0` panorama and combined release bytes additionally require human rights approval before public staging review, production activation, or final publication.
