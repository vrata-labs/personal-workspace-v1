# Personal Workspace 0.4.0 authoring task

Outcome: REWORK_REQUIRED. User rejected 0.3.0; no visual acceptance is implied.
Base: cc73c73662dc9f2fec1a4e078a1dccf3a37d6c8d.
Shared quality contract: platform 8ba49739d44518a3e877bc93432be591ce2e72da.
Visual benchmark: WMMR 0.3.3, 5580a7b080cf6195e28ebc77b654fd71111b0cd1.
Inspected benchmark images: diagonal-overview, table-underside and window-detail.

## Brief

A believable quiet private study: warm timber, off-white plaster, charcoal metal,
soft neutral upholstery, a real working desk and a compact reading/library area.
Keep one owner seat and workspace-main runtime surface. Preserve the 6.4 x 5.2 m
room envelope and entrance; redesign the furniture and details where necessary.
The window needs photographic distant scenery with coherent daylight. No style
exception permits cartoon geometry or a painted skyline.

## Observed defects and corrections

| ID | Observed in 0.3.0/source | Required correction |
| --- | --- | --- |
| P1 | Procedurally illustrated panorama | Licensed photographic panorama, inspect from near/far and seated views |
| P2 | Thick featureless timber and flat block colors | Actual wood grain/roughness at metric scale, realistic panel thickness/edges |
| P3 | Cup is a capped cylinder with a black disc | Hollow ceramic body, rim, cavity and attached handle, resting on desk |
| P4 | Cabinet is a solid cuboid with a black fake niche | Board-built carcass, real cavity/shelf, doors with reveals and hardware |
| P5 | Chair caster cylinders have vertical axes; spine/support needs review | Five-spoke office base, horizontal wheels/forks, actual seat/back/arm attachments |
| P6 | Plant leaves are thick ellipsoidal discs | Thin curved leaves attached through petioles, credible species/silhouette, pot/soil |
| P7 | Keyboard and book blocks lack believable proportions/detail | Familiar key layout, slim chassis; books with boards/page blocks and supported placement |
| P8 | Pendant/door/window assembly represented loosely | Mounted fixture, credible lever/hinges, continuous frame/sill/reveal contacts |

## Requirement coverage

| ID | Implementation and evidence obligation | Status |
| --- | --- | --- |
| Q1 | Paired entry, seated desk, reading, diagonal, material and joint views | pending |
| Q2 | Individually named desk, chair, display, input devices, cup, notebook, book families, shelving, reading chair/table/lamp, window, door, plant and fixtures | pending |
| Q3 | Measured contacts and assembly review after final model/export | pending |
| Q4 | Owner seat/media interactive; cup/books/door hardware passive/deferred, physically usable | pending |
| Q5 | Desk knee/hand clearance, seated display rays, entrance-to-desk and reading approaches, plant outside route | pending |
| Q6 | Photographic source ledger, window views, seam/yaw/scale and memory budget | pending |
| Q7 | Compare to accepted WMMR, never treat 0.3.0 as the quality target | applied to brief |

## Real use and construction

- Owner approaches behind the desk chair, sits facing workspace-main, reaches a
  keyboard/mouse and notebook without the cup occupying the input zone. Table
  height target 0.74 m, seat 0.46-0.49 m; verify actual knee and arm clearances.
- Desk: 30 mm veneered top on steel legs/frame, bolted brackets and cable tray;
  drawer storage must not occupy the knee envelope. Display has a wall mount and
  power/data routing; the runtime plane sits in front of its backing.
- Reader approaches an upholstered timber-frame chair, reaches a side table and
  floor lamp. Shelf boards carry books; bookshelf is floor-supported and anchored
  to the wall. Book/page/cover dimensions remain plausible.
- Window profiles attach within the masonry opening; sill bears on reveal.
  Door leaf has jamb, hinge side, latch/lever side and plausible hand clearance.
- Plant stays in the corner outside use/routes: ceramic pot on floor, soil inside,
  stems rooted in soil, leaves attached to petioles. Fixtures attach to ceilings or
  weighted bases; light sources correspond to actual visible fixtures/window.

## Evidence plan

Source/browser: entry, owner-seated, workspace-detail, reading, diagonal-overview,
window-near, window-seated, desk-underneath, shelf-detail, door-detail. Additional
views whenever a defect is not visible in these. Run interaction and normal media
views separately from clean visual comparison. Record measured roles and image
criticisms before freezing the source. Technical parity is a separate result.

## Draft image criticism, iteration 1

Entry and diagonal source images inspected. Floor grain, real cabinet cavities,
thin worktop, horizontal casters and the photographic exterior improve the result.
Still DRAFT: walnut is too glossy/red, the overview camera intersects the reading
lamp silhouette, and leaf face orientation is wrong. Corrections: satin-finish
roughness derivative, reduced wood normal strength, more neutral wood color,
relocated overview camera and corrected leaf winding. These changes are required
before source quality can pass; they will also apply to Presentation materials.

## Construction/use corrections after close-up inspection

Added an actual lounge-seat deck and plywood back, connected desk cable-tray
brackets, closed a 9 mm door-rosette gap, corrected recline and caster directions,
lowered the task seat to 479 mm, and gave the notebook two real boards rather than
a solid enclosing cuboid. The work display is now a believable 55-inch all-in-one
unit with the same workspace-main binding; its new surface is 1.20 x 0.675 m.
Moved the underside camera out of the chair. Preliminary real-geometry screen
rays are clear; all 347 physical/background parts are inventoried, and the
physical AABB broadphase has no disconnected parts. That broadphase is labelled
approximate and does not substitute for surface contacts and image review.

Narrow-phase triangle/vertex contact checks subsequently found a 5 mm planter
floor gap, a detached lamp diffuser and a socket plate gap that AABBs concealed.
These were corrected geometrically. The plant moved to the north-west corner,
away from the cabinet opening and window reveal; soil is a supported filled
volume rather than a floating top disc. The window now has continuous glazing
gaskets; fully clear glazing remains an explicitly documented optical simplification.

## Lighting transfer correction

The first browser captures lost gradients and showed noisy lightmaps. Measured
atlas pixels confirmed broad clipping with the inherited fixed 0.25 encode scale.
The revised bake records HDR percentiles/clipping, scales to the measured range,
denoises irradiance without baking AgX into it, and decodes diffuse radiance to
runtime irradiance. It bakes a temporary joined copy once while preserving all
original object/part geometry. The runtime material contract additionally avoids
double environment diffuse while retaining IBL specular for complete atlases.
The old captures are diagnostic iterations, not final acceptance evidence.

Camera review found that the runtime rotates its 1.6 m camera offset with the
pitch parent. Merely subtracting 1.6 from DCC eye Y displaced pitched captures
horizontally. The revised harness inverts the complete yaw/pitch eye offset and
checks actual camera world position/direction per view. Earlier capture batches
are diagnostic only; final evidence must use this corrected camera binding.

## 2026-09-20 normal-product gate

Runtime tested: platform d9eaa25f52bc5ef1bdd8622d83b22a09dc81f84a.
Current diagnostic GLB: ec8e32a52a604367d92714bc5946d784ab3f357e1f35c7ea0ae85cc1a01b2cf6,
20,924,412 bytes. This is an unaccepted diagnostic artifact, not an immutable release.

- Regenerated source and denoised atlas; 10 source views and 10 paired clean browser
  views were captured. Actual browser response SHA and camera position/direction
  are checked. Khronos validation: zero errors and warnings after pinned MikkTSpace
  finalization; 385 meshes, 23 materials, 22 lightmapped materials.
- Shipping panorama is a 4096x2048 derivative with exact source/derivation ledger;
  estimated RGBA texture memory with mipmaps is 128 MiB. The close window view still
  needs comparison with the inherited photographic-quality target; memory compliance
  does not establish exterior visual quality.
- Actual server-authoritative owner-seat claim/release was observed by a second
  participant. Movement while seated was locked. The real seated camera is at
  y=2.079m, i.e. 1.6m above the 0.479m cushion, versus the designed 1.20m seated eye.
  This is a blocking Q4/Q5 failure. Clean synthetic views do not close it.
- workspace-main has a physical plane but no corresponding logical room-state
  surface. Content creation returns missing-surface; allowedObjectTypes is empty
  and inputEnabled is false. This is a blocking product interaction failure.
- Post-release floor pose requires an explicit assertion; occupancy removal alone
  is insufficient. The first run's standing-movement check used an assumed origin
  and cannot establish successful teleport placement. The final strengthened local
  run checked the actual released pose and passed this assertion for the owner seat.
- Assembly-constrained surface connectivity reports 384/384, but is not a declared
  per-part load-path/Builder pass. Cable/socket chains and aggregate support must
  still be reviewed against construction, with direct intended support edges.
- The initial hand checker was incorrectly relaxed for individual targets after a
  failure. The uniform 0.85m screening ceiling is restored: the notebook is 0.9944m
  from the assumed shoulder point and needs rework. The earlier green Q5 claim is
  withdrawn. Route AABBs and the assumed shoulder point are screening evidence,
  not final ergonomic acceptance.

Evidence is in build/redesign-0.4.0/runtime-040-normal and runtime-040-clean-1;
the runtime harness is scene-quality-0.4-local.spec.ts. No immutable acceptance
index, rights approval, human visual acceptance, or promotion is created here.

Independent re-export of the same saved review source and accepted-for-diagnostics
atlas, followed by finalize-glb.mjs, is byte-identical to the current diagnostic
GLB (cmp passed). This verifies same-host export repeatability only, not a fresh
author/bake reproducibility run. The pinned WMMR diagonal-overview image was fetched
and re-inspected during this continuation; there is no new human quality verdict.

## Platform correction follow-up

Platform PR #98 was admin-merged as dcd6bdd49280a57a819bc30ff0aac171644097ec.
The subsequent runtime fixes are in platform PR #100, commit
dfb2f73151d93b1f7bfdf1d5b7bbd56074656bf1. The local normal-product run against
that implementation passed: the owner seated eye is about 1.199m, claim/release
and floor teleport work, and workspace-main accepts its markdown-board object.
The diagnostic output is runtime-040-normal-fixed. The public regression also
checks rendered/shared sticky notes and the published avatar head height.

The scene remains REWORK_REQUIRED for notebook reach, intended per-part support,
complete role/visual evidence and release packaging. Admin merge permission is
not exact-byte rights approval, human visual acceptance or scene promotion.

Platform PR #100 was admin-merged as c6343de81b038b7937addac44c24fa7c46adf341.
Its normal pipeline staging run 35512150893 passed on retry after a pre-rollout
SSH disconnect: 39/39 staging e2e plus the blocking Rutube test. Running API and
room-state image tags were independently confirmed at that SHA. The new public
normal-product regression passed with an inline platform fixture. This verifies
the platform correction on staging, not public delivery of these private 0.4.0 bytes.

## Irradiance speckle correction

The cross-scene Presentation investigation isolated residual wall/ceiling speckle
to the baked irradiance atlas. Raising Cycles from 96 to 384 samples did not
materially improve the browser result. A deterministic 5x5 median post-filter after
the Blender compositor denoise removed the speckle while preserving contact and
construction detail, so the accepted pipeline keeps 96 samples. Personal exact-byte
browser comparisons cover workspace, window, desk underside and shelf close-ups;
the current-to-filtered RMSE range is 0.0033-0.0088 with no observed semantic loss.
The filter uses ImageMagick 6.9.12-98 Q16 and is now part of denoise-atlas.py rather
than an unrecorded diagnostic command.
