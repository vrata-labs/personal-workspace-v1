# Personal Workspace v1

Visually accepted scene for the FEAT-032 owner-bound private workspace. This is an original compact creative studio, not the eight-seat warm-modern meeting candidate.

## 0.4.1 — visually accepted

The current review bundle is [0.4.1](assets/scenes/personal-workspace-v1/0.4.1/scene.json).
It contains 149 supported reference volumes, realistic binding/page geometry,
restrained timber finishes, a photographic exterior and a continuous baked enclosure.
Shipping cost is 79,546 triangles and 214 render primitives. Book clustering,
restraints, retrieval space and shelf load paths follow the shared Q8 arrangement rule.

See the [source views](source/releases/0.4.1/review), [browser views](provenance/runtime-capture-0.4.1/clean),
[working display](provenance/runtime-capture-0.4.1/normal-product/normal-workspace-content.png)
and [quality assessment](provenance/releases/0.4.1/quality-review.json).
The user explicitly accepted the delivered 0.4.1 scene on 2026-09-21:
[human visual acceptance](docs/reviews/2026-09-21-0.4.1-visual-acceptance.md).
Workflow outcome: **VISUALLY_ACCEPTED**. Frozen release/evidence pending fields
record the pre-review state; the later human verdict is recorded separately.
Public staging review is authorized; current-release selection and publication
readiness retain their separate gates (isCurrent=false, publicationReady=false).

[Open the public review room](https://158.160.10.234.sslip.io/rooms/review-personal-workspace-041-e0042809).
[Published-scene evidence](docs/staging/0.4.1/verification.json) and
[the corrected library on staging](docs/staging/0.4.1/detail-shelf-group.png)
are recorded separately from the immutable release.

The validator binds actual geometry bounds, source/capture bytes and the exact
platform revision a3a905ea3bcbe290e77fa4c7fc2dd92214097a4d. Historical checks run in
the pinned 0.4.0 tooling worktree; the current checkout's historical bytes and
append-only indexes are independently checked. This avoids rewriting old evidence
to accommodate new tooling. Reproducibility means two identical saved-baked-source
exports, not independent author/bake runs.

## Historical quality disposition: 0.3.0 and 0.4.0 require rework

On 2026-09-19 the user rejected the visual quality of 0.3.0 at merge commit
`705ed359269b5f9cd19168e63f0d7c3fc15a73b0`: simplified object design, insufficient
real-use/construction reasoning, flat material appearance and an illustrated
panorama do not meet the inherited realistic quality target. Green technical
checks and immutable pre-review pending fields are not a positive visual verdict.

New work must use the [shared quality contract](https://github.com/vrata-labs/platform/blob/8ba49739d44518a3e877bc93432be591ce2e72da/docs/scene-quality-contract.md)
and its [task packet](https://github.com/vrata-labs/platform/blob/8ba49739d44518a3e877bc93432be591ce2e72da/docs/scene-authoring-task-template.md),
including all-object User/Builder/Physics passes, realistic materials and photographic
exterior evidence. Passive objects remain allowed. Do not repeat the same-candidate
capture calibration as a substitute for matching the accepted quality benchmark.
This records the rejection separately; published 0.3.0 source/release evidence is immutable. Release `0.4.0` is a new from-scratch candidate built under that contract. Its functional runtime capture passed, but source-to-runtime wood appearance and lightmap seams remain unresolved, and 397 meshes exceed the 250-mesh budget without an approved exception. It therefore remains `REWORK_REQUIRED`, non-current, and not publication-ready.

## Boundary

The repository owns one scene ID, `personal-workspace-v1`, and six immutable review versions through `0.4.1`. Historical public-staging rights apply to the exact `0.1.x` and `0.2.0` bytes. Versions `0.3.0` and `0.4.0` keep their pending-rights and rework records. A new explicit decision authorizes `0.4.1` for isolated public staging review. No version is marked current, production-active or publication-ready.

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
source/releases/0.4.0/{authoring-task,release-LICENSES}.md
source/releases/0.4.0/{author-scene,export-scene,fetch-assets,render-review}.py
source/releases/0.4.0/{authored-scene,baked-scene}.blend
source/releases/0.4.0/{scene-manifest,object-registry,review-source-lock}.json
source/releases/0.4.0/review/*.{webp,png}
source/releases/0.4.0/textures/*
provenance/*.json
provenance/releases/0.3.0/*
provenance/releases/0.4.0/*
provenance/runtime-capture-0.3.0/{run-1,run-2,run-3}/
provenance/runtime-capture-0.4.0/{clean,normal}/
assets/scenes/personal-workspace-v1/0.1.0/
assets/scenes/personal-workspace-v1/0.1.1/
assets/scenes/personal-workspace-v1/0.2.0/
assets/scenes/personal-workspace-v1/0.3.0/
assets/scenes/personal-workspace-v1/0.4.0/
provenance/baked-lightmap-0.2.0.json
provenance/runtime-capture-0.2.0/
manifest.json
```

## Local Pipeline

```bash
pnpm install --frozen-lockfile
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

The `0.4.0` source is isolated under `source/releases/0.4.0/`. Its authoring task, object cards, support graph, source images, accepted authored and baked Blend files, export script, fixed review views, and license snapshots are bound by `review-source-lock.json`. Four Poly Haven assets are admitted only through the exact URLs and downloaded bytes recorded in that lock; their CC0 terms are documented, but the release-level rights gate remains pending. Materialization exports twice from the accepted baked Blend and requires byte-identical raw and meshopt-compressed GLBs before accepting the four-file release directory. The release ledger binds the GLB inventory, role measurements, support measurements, quality disposition, runtime capture index, source lock, and release records. The clean and normal browser captures are one exact-byte functional evidence pair, not a three-run stability claim and not human visual acceptance.

Append-only release history and versioned source/provenance directories are protected by validation and CI. A future release appends a new version; it does not replace, hide, or rewrite an existing release.

The pinned Blender reproducibility gate remains mandatory. `pnpm verify:reproducibility` requires `BLENDER_BIN`, verifies Blender 4.5.12 LTS build `84afd5f785f7` and its binary hash, reproduces the historical `0.1.0`, metadata-only `0.1.1`, and baked `0.2.0` releases, reproduces the `0.3.0` GLB and decoded panorama pixels twice, and independently materializes `0.4.0` twice from its accepted baked Blend. Every run must match the exact hash-bound release inputs and outputs. Review WebP encoder bytes are not claimed reproducible.

The visual acceptance boundary remains open for every release. The exact `0.3.0` and `0.4.0` release bytes additionally require human rights approval before public staging review, production activation, or final publication. Release `0.4.0` also requires a new version that resolves its recorded visual-fidelity defects and mesh-budget failure; immutable review bytes are not repaired in place.
