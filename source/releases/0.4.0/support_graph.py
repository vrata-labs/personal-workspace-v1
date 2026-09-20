"""Source-authored support graph for Personal Workspace 0.4.0."""
import json

import bpy


def declare_support_graph(cards):
    supports = {}

    def add(part, targets, joint, all_required=True):
        if part in supports:
            raise RuntimeError(f"duplicate_support:{part}")
        supports[part] = {
            "part": part,
            "targets": [targets] if isinstance(targets, str) else list(targets),
            "joint": joint,
            "allRequired": all_required,
        }

    for part in ("north", "west", "south-left", "south-right", "east-south", "east-north", "window-below"):
        add(f"room-shell.{part}", "room-shell.floor", "masonry-bearing-contact")
    add("room-shell.door-lintel", "room-shell.south-left", "continuous-masonry-joint")
    add("room-shell.window-above", ["room-shell.east-south", "room-shell.east-north"], "continuous-masonry-joint")
    add("room-shell.ceiling", ["room-shell.north", "room-shell.west"], "ceiling-bearing-joint")

    for part in ("north", "west", "east", "south-left", "south-right"):
        add(f"skirting.{part}", "room-shell.floor", "fixed-floor-wall-junction")

    add("main-window.sill", "room-shell.window-below", "bedded-sill")
    add("main-window.frame-bottom", "main-window.sill", "screwed-frame-joint")
    for part in ("frame-south", "frame-north"):
        add(f"main-window.{part}", "main-window.frame-bottom", "screwed-frame-joint")
    add("main-window.frame-top", ["main-window.frame-south", "main-window.frame-north"], "screwed-frame-joint")
    add("main-window.mullion", ["main-window.frame-bottom", "main-window.frame-top"], "mechanical-mullion-joint")
    for bay, side_a, side_b in (("south", "frame-south", "mullion"), ("north", "mullion", "frame-north")):
        add(f"main-window.{bay}-gasket-bottom", "main-window.frame-bottom", "compression-gasket")
        add(f"main-window.{bay}-gasket-top", "main-window.frame-top", "compression-gasket")
        add(f"main-window.{bay}-gasket-a", f"main-window.{side_a}", "compression-gasket")
        add(f"main-window.{bay}-gasket-b", f"main-window.{side_b}", "compression-gasket")

    add("main-door.jamb-left", "room-shell.south-left", "fixed-jamb")
    add("main-door.jamb-right", "room-shell.door-lintel", "fixed-jamb")
    add("main-door.jamb-head", ["main-door.jamb-left", "main-door.jamb-right"], "joined-jamb-head")
    for index in range(3):
        add(f"main-door.hinge-jamb-{index}", "main-door.jamb-right", "screwed-hinge-leaf")
        add(f"main-door.hinge-{index}", f"main-door.hinge-jamb-{index}", "hinge-pin-bearing")
        add(f"main-door.hinge-door-{index}", f"main-door.hinge-{index}", "hinge-pin-bearing")
    add("main-door.leaf", [f"main-door.hinge-door-{index}" for index in range(3)], "three-hinge-door-support")
    add("main-door.rosette", "main-door.leaf", "through-bolted-rosette")
    add("main-door.lever", "main-door.rosette", "lever-spindle-joint")
    add("main-door.latch", "main-door.leaf", "mortised-latch")

    for index in range(2):
        add(f"owner-desk.foot-{index}", "room-shell.floor", "floor-bearing-foot")
        add(f"owner-desk.column-{index}", f"owner-desk.foot-{index}", "bolted-column-foot")
        add(f"owner-desk.mount-{index}", f"owner-desk.column-{index}", "bolted-top-mount")
        add(f"owner-desk.tray-bracket-{index}", "owner-desk.top", "screwed-tray-bracket")
    add("owner-desk.top", ["owner-desk.mount-0", "owner-desk.mount-1"], "two-point-bolted-worktop")
    add("owner-desk.cross-rail", ["owner-desk.column-0", "owner-desk.column-1"], "bolted-cross-rail")
    add("owner-desk.tray", ["owner-desk.tray-bracket-0", "owner-desk.tray-bracket-1"], "two-bracket-tray")

    add("desk-power.outlet", "room-shell.north", "flush-wall-box")
    for index in range(2):
        add(f"desk-power.socket-{index}", "desk-power.outlet", "receptacle-insert")
        for side in (-1, 1):
            add(f"desk-power.pin-well-{index}-{side}", f"desk-power.socket-{index}", "molded-receptacle")
            add(f"desk-power.earth-{index}-{side}", f"desk-power.socket-{index}", "spring-contact")
    add("desk-power.plug", "desk-power.outlet", "inserted-plug")
    add("desk-power.cable", "desk-power.plug", "molded-strain-relief")

    add("workspace-main.mount", "room-shell.north", "wall-anchor")
    add("workspace-main.chassis", "workspace-main.mount", "vesa-bolts")
    add("workspace-main.face", "workspace-main.chassis", "integrated-display-face")
    add("workspace-main.status-led", "workspace-main.chassis", "integrated-indicator")

    add("keyboard.chassis", "owner-desk.top", "resting-contact")
    for name in cards["keyboard"]["parts"]:
        if name != "keyboard.chassis":
            add(name, "keyboard.chassis", "key-switch-mount")
    add("mouse.body", "owner-desk.top", "resting-contact")
    add("mouse.wheel", "mouse.body", "axle-joint")
    add("notebook.bottom-board", "owner-desk.top", "resting-contact")
    add("notebook.pages", "notebook.bottom-board", "bound-signature-contact")
    add("notebook.top-board", "notebook.pages", "bound-board-contact")
    add("notebook.spine", ["notebook.bottom-board", "notebook.top-board"], "bound-spine")
    add("pen.barrel", "notebook.top-board", "resting-contact")
    add("pen.cap", "pen.barrel", "friction-fit-cap")
    add("coffee-cup.body", "owner-desk.top", "stable-foot-contact")
    add("coffee-cup.handle", "coffee-cup.body", "fired-ceramic-joint")
    add("coffee-cup.coffee", "coffee-cup.body", "contained-liquid-surface")

    for index in range(5):
        wheels = [f"owner-chair.wheel-{index}-{side}" for side in (-1, 1)]
        for wheel in wheels:
            add(wheel, "room-shell.floor", "rolling-floor-contact")
        add(f"owner-chair.caster-fork-{index}", wheels, "twin-wheel-axle")
        add(f"owner-chair.spoke-{index}", f"owner-chair.caster-fork-{index}", "caster-stem-joint")
    add("owner-chair.sleeve", [f"owner-chair.spoke-{index}" for index in range(5)], "five-star-hub")
    add("owner-chair.gas-lift", "owner-chair.sleeve", "telescoping-column")
    add("owner-chair.carrier", "owner-chair.gas-lift", "seat-carrier-taper")
    add("owner-chair.seat", "owner-chair.carrier", "bolted-seat-pan")
    add("owner-chair.back-carrier", "owner-chair.carrier", "bolted-back-carrier")
    add("owner-chair.back-shell", "owner-chair.back-carrier", "bolted-back-shell")
    add("owner-chair.back-cushion", "owner-chair.back-shell", "upholstery-on-shell")
    for side in (-1, 1):
        add(f"owner-chair.arm-{side}", "owner-chair.seat", "bolted-arm-bracket")
        add(f"owner-chair.arm-pad-{side}", f"owner-chair.arm-{side}", "fastened-arm-pad")

    add("library.plinth", "room-shell.floor", "floor-bearing-plinth")
    add("library.bottom", "library.plinth", "carcass-base-joint")
    for side in ("south", "north"):
        add(f"library.side-{side}", "library.bottom", "carcass-dowel-joint")
    add("library.top", ["library.side-south", "library.side-north"], "carcass-top-joint")
    add("library.back", ["library.bottom", "library.top"], "fixed-backing")
    for index in range(3):
        add(f"library.shelf-{index}", ["library.side-south", "library.side-north"], "two-sided-shelf-support")
    shelf_parts = ["library.bottom", "library.shelf-0", "library.shelf-1", "library.shelf-2"]
    for index in range(1, 21):
        key = f"book-{index:02d}"
        add(f"{key}.pages", shelf_parts[(index - 1) // 5], "resting-book-contact")
        add(f"{key}.spine", f"{key}.pages", "bound-spine")
        for side in (-1, 1):
            add(f"{key}.board-{side}", f"{key}.pages", "bound-cover-board")

    add("storage-cabinet.plinth", "room-shell.floor", "floor-bearing-plinth")
    add("storage-cabinet.base", "storage-cabinet.plinth", "carcass-base-joint")
    for side in ("left", "right"):
        add(f"storage-cabinet.side-{side}", "storage-cabinet.base", "carcass-dowel-joint")
    add("storage-cabinet.back", "storage-cabinet.base", "fixed-backing")
    for part in ("middle", "shelf", "top"):
        add(f"storage-cabinet.{part}", ["storage-cabinet.side-left", "storage-cabinet.side-right"], "two-sided-carcass-joint")
    for side in (-1, 1):
        for index in range(2):
            add(f"storage-cabinet.hinge-{side}-{index}", f"storage-cabinet.side-{'left' if side < 0 else 'right'}", "concealed-cabinet-hinge")
        add(f"storage-cabinet.door-{side}", [f"storage-cabinet.hinge-{side}-{index}" for index in range(2)], "two-hinge-door-support")
        add(f"storage-cabinet.pull-{side}", f"storage-cabinet.door-{side}", "through-bolted-pull")

    add("reading-rug.woven-body", "room-shell.floor", "non-slip-floor-contact")
    for side in (-1, 1):
        for end in ("front", "rear"):
            add(f"reading-chair.leg-{side}-{end}", "reading-rug.woven-body", "floor-bearing-leg")
        add(f"reading-chair.side-rail-{side}", [f"reading-chair.leg-{side}-front", f"reading-chair.leg-{side}-rear"], "mortise-and-tenon-rail")
        add(f"reading-chair.arm-post-{side}", f"reading-chair.side-rail-{side}", "joined-arm-post")
        add(f"reading-chair.back-stile-{side}", f"reading-chair.leg-{side}-rear", "continuous-rear-stile")
        add(f"reading-chair.armrest-{side}", [f"reading-chair.arm-post-{side}", f"reading-chair.back-stile-{side}"], "two-point-armrest-joint")
    for index in range(2):
        add(f"reading-chair.cross-rail-{index}", ["reading-chair.side-rail--1", "reading-chair.side-rail-1"], "cross-rail-joint")
    add("reading-chair.seat-deck", ["reading-chair.side-rail--1", "reading-chair.side-rail-1"], "seat-deck-bearing")
    add("reading-chair.cushion", "reading-chair.seat-deck", "upholstered-seat-contact")
    add("reading-chair.plywood-back", ["reading-chair.back-stile--1", "reading-chair.back-stile-1"], "back-panel-fasteners")
    add("reading-chair.back", "reading-chair.plywood-back", "upholstery-on-shell")

    for index in range(3):
        add(f"reading-table.leg-{index}", "reading-rug.woven-body", "floor-bearing-leg")
    add("reading-table.mount", [f"reading-table.leg-{index}" for index in range(3)], "three-leg-mount")
    add("reading-table.top", "reading-table.mount", "top-fastener-block")

    add("reading-lamp.base", "room-shell.floor", "weighted-floor-base")
    add("reading-lamp.stem", "reading-lamp.base", "threaded-stem-joint")
    add("reading-lamp.top-cap", "reading-lamp.stem", "threaded-cap-joint")
    add("reading-lamp.shade", "reading-lamp.top-cap", "shade-retaining-ring")
    add("reading-lamp.diffuser", "reading-lamp.shade", "diffuser-retaining-lip")
    add("reading-lamp.socket-plate", "room-shell.west", "flush-wall-box")
    add("reading-lamp.plug", "reading-lamp.socket-plate", "inserted-plug")
    add("reading-lamp.lead", "reading-lamp.plug", "molded-strain-relief")
    add("reading-lamp.foot-switch", "room-shell.floor", "floor-resting-switch")

    add("window-plant.pot", "room-shell.floor", "stable-planter-foot")
    add("window-plant.soil", "window-plant.pot", "contained-soil")
    add("window-plant.trunk", "window-plant.soil", "rooted-trunk")
    for index in range(20):
        add(f"window-plant.petiole-{index}", "window-plant.trunk", "botanical-node")
        add(f"window-plant.leaf-{index}", f"window-plant.petiole-{index}", "leaf-petiole-joint")
        add(f"window-plant.midrib-{index}", f"window-plant.leaf-{index}", "integrated-leaf-vein")

    for index in range(2):
        add(f"ceiling-luminaire.canopy-{index}", "room-shell.ceiling", "ceiling-anchor")
        add(f"ceiling-luminaire.cable-{index}", f"ceiling-luminaire.canopy-{index}", "suspension-cable-clamp")
    add("ceiling-luminaire.housing", ["ceiling-luminaire.cable-0", "ceiling-luminaire.cable-1"], "two-cable-suspension")
    add("ceiling-luminaire.diffuser", "ceiling-luminaire.housing", "diffuser-retaining-channel")
    for index in range(4):
        add(f"ceiling-downlights.trim-{index}", "room-shell.ceiling", "recessed-ceiling-clip")
        add(f"ceiling-downlights.optic-{index}", f"ceiling-downlights.trim-{index}", "optic-retaining-ring")

    physical = {
        obj.name for obj in bpy.data.collections["Runtime"].objects
        if obj.type == "MESH" and obj.get("vrataBakePolicy") == "include"
    }
    root = "room-shell.floor"
    missing = sorted(physical - {root} - set(supports))
    extra = sorted(set(supports) - physical)
    if missing or extra:
        raise RuntimeError(f"support_graph_coverage:missing={missing}:extra={extra}")
    for declaration in supports.values():
        for target in declaration["targets"]:
            if target not in physical:
                raise RuntimeError(f"support_target_missing:{declaration['part']}:{target}")
        obj = bpy.data.objects[declaration["part"]]
        obj["vrataSupportTargets"] = json.dumps(declaration["targets"], separators=(",", ":"))
        obj["vrataSupportJoint"] = declaration["joint"]
    return supports
