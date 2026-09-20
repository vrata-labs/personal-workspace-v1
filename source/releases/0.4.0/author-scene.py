"""Personal study: dimensioned assemblies, photographic materials, real panorama.

Coordinates are Blender Z-up meters; runtime conversion is (x, z, -y).
This authoring entry point writes only untracked 0.4.0 scratch output.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import runpy
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CARDS = {}
VIEWS = {}
M = {}
SUPPORTS = {}
OUTPUT = None


def safe_output(path):
    path = Path(path).absolute()
    relative = path.relative_to(ROOT)
    if not (relative.parts[0] == "build" or relative.parts[:3] == ("source", "releases", "0.4.0")):
        raise RuntimeError("output_outside_new_version")
    current = ROOT
    for name in relative.parts:
        current /= name
        if current.is_symlink():
            raise RuntimeError("output_symlink")
    for args in (["ls-tree", "--name-only", "HEAD", "--", relative.as_posix()], ["ls-files", "--", relative.as_posix()]):
        result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True)
        if result.stdout.strip():
            raise RuntimeError("tracked_output")
    return path


def linear(hex_value):
    values = [int(hex_value[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in values) + (1,)


def card(key, label, use, assembly, support, status="passive"):
    if key in CARDS:
        raise RuntimeError(f"duplicate_object:{key}")
    CARDS[key] = dict(
        objectId=key,
        label=label,
        intendedUsers=["room occupant", "facilities maintainer"],
        expectedUse=use,
        expectedActions=[use],
        dimensions={"method": "measured final mesh bounds", "rationale": "metric real-world proportions from the authoring task"},
        materialFinish={"method": "final per-part material inventory"},
        construction=assembly,
        supportedBy=support,
        supportContact="measured against the declared supporting assembly",
        interactionStatus=status,
        scenarioIds=[f"{key}-use", f"{key}-support"],
        evidenceViews=["entry", "diagonal-overview"],
        parts=[])


def material(key, color, rough=.6, metal=0, image_asset=None, period=1.0, glow=0):
    mat = bpy.data.materials.new(f"material.{key}")
    mat.use_nodes = True
    mat.diffuse_color = linear(color)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = linear(color)
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Metallic"].default_value = metal
    if glow:
        shader.inputs["Emission Color"].default_value = linear(color)
        shader.inputs["Emission Strength"].default_value = glow
    mat["uvPeriodMeters"] = period
    if image_asset:
        uv = mat.node_tree.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        for channel, socket in (("diff", "Base Color"), ("rough", "Roughness"), ("nor_gl", "Normal")):
            image = bpy.data.images.load(str(HERE / "textures" / f"{image_asset}-{channel}.jpg"), check_existing=True)
            image.colorspace_settings.name = "sRGB" if channel == "diff" else "Non-Color"
            if image_asset == "wood_table_001" and channel in ("diff", "rough"):
                original = image
                image = bpy.data.images.new(f"satin-walnut-{channel}", width=original.size[0], height=original.size[1], alpha=False)
                image.colorspace_settings.name = "sRGB" if channel == "diff" else "Non-Color"
                pixels = np.empty(len(original.pixels), dtype=np.float32)
                original.pixels.foreach_get(pixels)
                rgba = pixels.reshape((-1, 4))
                if channel == "diff":
                    rgba[:, :3] *= np.array([.72, .82, .95])
                else:
                    rgba[:, :3] = .44 + .28*rgba[:, :3]
                image.pixels.foreach_set(pixels)
                image.filepath_raw = str(OUTPUT/f"satin-walnut-{channel}.png")
                image.file_format = "PNG"
                image.save()
            image.pack()
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = image
            mat.node_tree.links.new(uv.outputs["UV"], tex.inputs["Vector"])
            output = tex.outputs["Color"]
            if channel == "nor_gl":
                normal = mat.node_tree.nodes.new("ShaderNodeNormalMap")
                normal.inputs["Strength"].default_value = .18 if image_asset == "wood_table_001" else .35 if "fabric" in image_asset else .5
                mat.node_tree.links.new(output, normal.inputs["Color"])
                output = normal.outputs["Normal"]
            mat.node_tree.links.new(output, shader.inputs[socket])
        mat["sourceAssetId"] = image_asset
    M[key] = mat
    return mat


def finish(name, obj, mat, smooth=False):
    group, part = name.split(".", 1)
    if group not in CARDS:
        raise RuntimeError(f"undeclared_object:{group}")
    obj.name = name
    obj.data.name = f"mesh.{name}"
    obj.data.materials.append(M[mat] if isinstance(mat, str) else mat)
    value = obj.data.materials[0]
    # Metric face projection, before later lightmap unwrap. No generated coordinates.
    layer = obj.data.uv_layers.get("UVMap") or obj.data.uv_layers.new(name="UVMap")
    period = value.get("uvPeriodMeters", 1.0)
    for poly in obj.data.polygons:
        axis = max(range(3), key=lambda a: abs(poly.normal[a]))
        axes = ((1, 2), (0, 2), (0, 1))[axis]
        for li in poly.loop_indices:
            vertex = obj.data.vertices[obj.data.loops[li].vertex_index].co
            layer.data[li].uv = (vertex[axes[0]]/period, vertex[axes[1]]/period)
        poly.use_smooth = smooth
    obj["vrataObjectId"] = group
    obj["vrataPartId"] = part
    obj["vrataInteractionStatus"] = CARDS[group]["interactionStatus"]
    obj["vrataBakePolicy"] = "include"
    obj["vrataCollisionPolicy"] = "scene-default"
    obj["vrataSupportPolicy"] = "included"
    obj["vrataNavigableBoundsPolicy"] = "include"
    obj["vrataAssetOrigin"] = "project-authored"
    obj["vrataAuthoringRelease"] = "0.4.0"
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    bpy.data.collections["Runtime"].objects.link(obj)
    CARDS[group]["parts"].append(name)
    return obj


def box(name, size, pos, mat, bevel=.003, rotation=(0, 0, 0), soft=False):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("manufactured-edge", "BEVEL")
        modifier.width = min(bevel, min(size)*.45)
        modifier.segments = 6 if soft else 3
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.rotation_euler = rotation
    finish(name, obj, mat, soft)
    if soft:
        modifier = obj.modifiers.new("weighted-surface-normals", "WEIGHTED_NORMAL")
        modifier.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def rod(name, start, end, radius, mat, vertices=24):
    start, end = Vector(start), Vector(end)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(end-start).length, location=(start+end)/2)
    obj = bpy.context.object
    obj.rotation_euler = (end-start).to_track_quat("Z", "Y").to_euler()
    return finish(name, obj, mat, True)


def tube(name, points, radius, mat, cyclic=False, handles="AUTO"):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    curve.resolution_u = 8
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    spline.use_cyclic_u = cyclic
    for v, point in zip(spline.bezier_points, points):
        v.co = point
        v.handle_left_type = v.handle_right_type = handles
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return finish(name, obj, mat, True)


def lathe(name, profile, pos, mat, segments=64):
    vertices, faces = [], []
    for radius, height in profile:
        for i in range(segments):
            theta = i*math.tau/segments
            vertices.append((pos[0]+radius*math.cos(theta), pos[1]+radius*math.sin(theta), pos[2]+height))
    for ring in range(len(profile)-1):
        for i in range(segments):
            a, b = ring*segments+i, ring*segments+(i+1)%segments
            faces.append((a, b, b+segments, a+segments))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(name, obj, mat, True)


def area(name, pos, target, energy, size, color="FFF0DA"):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.shape, data.size, data.size_y = energy, "RECTANGLE", size[0], size[1]
    data.color = linear(color)[:3]
    obj = bpy.data.objects.new(name, data)
    bpy.data.collections["Authoring"].objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector(target)-Vector(pos)).to_track_quat("-Z", "Y").to_euler()


def camera(key, pos, target, fov=58):
    data = bpy.data.cameras.new(f"camera.{key}")
    data.angle = math.radians(fov)
    data.clip_end = 150
    obj = bpy.data.objects.new(f"camera.{key}", data)
    bpy.data.collections["Authoring"].objects.link(obj)
    obj.location = pos
    obj.rotation_euler = (Vector(target)-Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    VIEWS[key] = {"position": pos, "target": target, "horizontalFovDegrees": fov}


def architecture():
    card("room-shell", "Plastered masonry room", "Provide enclosed work/reading space", "Masonry walls, plaster finish, engineered floor, gypsum ceiling", "building structure")
    box("room-shell.floor", (6.4, 5.2, .12), (0, 0, -.06), "floor", .002)
    for key, size, pos in [
        ("north", (6.4, .18, 3.1), (0, 2.65, 1.55)),
        ("west", (.18, 5.3, 3.1), (-3.25, 0, 1.55)),
        ("south-left", (4.90, .18, 3.1), (-.75, -2.65, 1.55)),
        ("south-right", (.50, .18, 3.1), (2.95, -2.65, 1.55)),
        ("door-lintel", (.90, .18, .85), (2.15, -2.65, 2.675)),
        ("east-south", (.18, 1.30, 3.1), (3.25, -1.95, 1.55)),
        ("east-north", (.18, .90, 3.1), (3.25, 2.15, 1.55)),
        ("window-below", (.18, 3.0, .70), (3.25, .20, .35)),
        ("window-above", (.18, 3.0, .60), (3.25, .20, 2.80)),
        ("ceiling", (6.5, 5.4, .12), (0, 0, 3.16))]:
        box(f"room-shell.{key}", size, pos, "plaster", .003)
    card("skirting", "Painted timber skirting", "Protect wall/floor junction", "Continuous 80 mm boards fixed to walls with finished corner joints", "room-shell")
    for key, size, pos in [("north", (6.32,.016,.08),(0,2.548,.04)),("west",(.016,5.12,.08),(-3.148,0,.04)),
        ("east",(.016,5.12,.08),(3.148,0,.04)),("south-left",(4.84,.016,.08),(-.73,-2.548,.04)),("south-right",(.44,.016,.08),(2.94,-2.548,.04))]:
        box(f"skirting.{key}",size,pos,"paint",.002)
    card("main-window", "Thermally broken fixed aluminum window", "Admit daylight and view exterior", "Continuous aluminum perimeter, mullion, gasket/bead joints and supported sill; clear fixed glazing is represented optically without an opaque runtime pane", "room-shell")
    for key, size, pos in [("sill",(.30,3.16,.032),(3.05,.2,.716)),("frame-bottom",(.11,3.0,.055),(3.19,.2,.7575)),
        ("frame-top",(.11,3.0,.055),(3.19,.2,2.4725)),("frame-south",(.11,.055,1.66),(3.19,-1.2725,1.615)),
        ("frame-north",(.11,.055,1.66),(3.19,1.6725,1.615)),("mullion",(.11,.036,1.66),(3.19,.35,1.615))]:
        box(f"main-window.{key}",size,pos,"wood" if key=="sill" else "metal",.0015)
    for bay,left,right in (("south",-1.245,.332),("north",.368,1.645)):
        for key,z in (("bottom",.791),("top",2.439)):
            box(f"main-window.{bay}-gasket-{key}",(.012,right-left,.012),(3.14,(left+right)/2,z),"rubber",.001)
        for key,y in (("a",left+.006),("b",right-.006)):
            box(f"main-window.{bay}-gasket-{key}",(.012,.012,1.636),(3.14,y,1.615),"rubber",.001)
    card("main-door", "Veneered flush entrance door", "Grasp lever and enter; operation deferred", "40 mm leaf on three hinges inside a continuous timber jamb; lever spindle and latch", "room-shell", "deferred")
    box("main-door.leaf",(.858,.04,2.185),(2.15,-2.58,1.10),"wood",.0015)
    for key,pos,size in [("left",(1.705,-2.58,1.125),(.032,.14,2.25)),("right",(2.595,-2.58,1.125),(.032,.14,2.25)),("head",(2.15,-2.58,2.242),(.858,.14,.032))]:
        box(f"main-door.jamb-{key}",size,pos,"wood",.001)
    for i,z in enumerate((.3,1.12,1.98)):
        rod(f"main-door.hinge-{i}",(2.578,-2.544,z-.042),(2.578,-2.544,z+.042),.008,"steel")
        box(f"main-door.hinge-jamb-{i}",(.026,.030,.074),(2.590,-2.565,z),"steel",.001)
        box(f"main-door.hinge-door-{i}",(.026,.030,.074),(2.566,-2.565,z),"steel",.001)
    rod("main-door.rosette",(1.82,-2.563,1.02),(1.82,-2.536,1.02),.024,"steel",32)
    tube("main-door.lever",[(1.82,-2.536,1.02),(1.82,-2.49,1.02),(1.94,-2.49,1.02)],.009,"steel")
    box("main-door.latch",(.022,.020,.075),(1.716,-2.574,1.02),"steel",.001)


def desk():
    card("owner-desk", "Veneered work desk", "Work seated; support input devices and writing", "30 mm top on bolted steel T-leg frame with rear cable tray", "room-shell")
    box("owner-desk.top",(2.30,.78,.032),(-1.05,1.64,.724),"wood",.006)
    for side,x in enumerate((-2.0,-.10)):
        box(f"owner-desk.foot-{side}",(.075,.66,.035),(x,1.64,.0175),"metal",.008)
        box(f"owner-desk.column-{side}",(.060,.065,.655),(x,1.64,.3625),"metal",.004)
        box(f"owner-desk.mount-{side}",(.11,.54,.018),(x,1.64,.699),"metal",.003)
    box("owner-desk.cross-rail",(1.94,.05,.065),(-1.05,1.6975,.66),"metal",.003)
    box("owner-desk.tray",(1.25,.14,.055),(-1.05,1.92,.636),"metal",.003)
    for i,x in enumerate((-1.55,-.55)):
        box(f"owner-desk.tray-bracket-{i}",(.026,.10,.050),(x,1.94,.684),"metal",.002)
    card("desk-power", "Type F double outlet and cable harness", "Power display and work devices", "Wall-mounted earthed socket plate, polymer receptacle inserts, plug and flexible lead clipped below desk", "room-shell", "deferred")
    box("desk-power.outlet",(.15,.030,.075),(-.10,2.545,.31),"paint",.003)
    for i,x in enumerate((-.14,-.07)):
        rod(f"desk-power.socket-{i}",(x,2.531,.31),(x,2.526,.31),.023,"paint",32)
        for side in (-1,1):
            rod(f"desk-power.pin-well-{i}-{side}",(x+side*.0095,2.527,.31),(x+side*.0095,2.5255,.31),.0025,"dark",16)
            box(f"desk-power.earth-{i}-{side}",(.006,.002,.003),(x,2.525,.31+side*.018),"steel",.0004)
    box("desk-power.plug",(.029,.030,.041),(-.08,2.515,.31),"dark",.006)
    tube("desk-power.cable",[(-.08,2.52,.31),(-.08,2.50,.10),(-.12,1.97,.10),(-.12,1.97,.62),(-.45,1.91,.63)],.004,"dark",handles="VECTOR")
    card("workspace-main", "Wall-mounted 55-inch all-in-one work display", "Read/share work content with paired wireless keyboard and mouse", "Integrated computer/display on VESA bracket, ventilated chassis; runtime face in front of backing", "room-shell", "interactive")
    box("workspace-main.mount",(.40,.10,.26),(-1.05,2.51,1.35),"metal",.003)
    box("workspace-main.chassis",(1.26,.043,.735),(-1.05,2.454,1.35),"dark",.008)
    box("workspace-main.face",(1.20,.003,.675),(-1.05,2.430,1.35),"screen",.0005)
    rod("workspace-main.status-led",(-.465,2.433,.993),(-.465,2.427,.993),.0018,"glow",12)
    card("keyboard", "Compact keyboard", "Type within comfortable reach", "Low chassis, separate keycaps and spacebar", "owner-desk", "deferred")
    box("keyboard.chassis",(.44,.145,.018),(-1.06,1.43,.749),"metal",.004)
    for row in range(5):
        for col in range(14):
            if row==0 and 3 <= col <= 9:
                continue
            box(f"keyboard.key-{row}-{col}",(.026,.023,.009),(-1.25+col*.029,1.374+row*.026,.762),"keys",.0015)
    box("keyboard.spacebar",(.20,.023,.009),(-1.075,1.374,.762),"keys",.0015)
    card("mouse", "Wireless ergonomic mouse", "Point/click beside keyboard", "Molded polymer upper shell on flat base with scroll wheel", "owner-desk", "deferred")
    box("mouse.body",(.061,.105,.034),(-.64,1.425,.757),"dark",.016,soft=True)
    rod("mouse.wheel",(-.646,1.45,.767),(-.634,1.45,.767),.009,"rubber",20)
    card("notebook", "Bound writing notebook", "Write notes beside input devices", "Paper signatures between two cloth boards", "owner-desk", "deferred")
    box("notebook.bottom-board",(.21,.28,.0025),(-1.50,1.41,.74125),"sage",.0007)
    box("notebook.pages",(.200,.27,.015),(-1.497,1.41,.750),"paper",.0007)
    box("notebook.top-board",(.21,.28,.0025),(-1.50,1.41,.75875),"sage",.0007)
    box("notebook.spine",(.004,.28,.020),(-1.603,1.41,.750),"sage",.001)
    card("pen", "Writing pen", "Uncap and write in notebook", "Capped metal barrel resting on notebook", "notebook", "deferred")
    rod("pen.barrel",(-1.58,1.33,.764),(-1.45,1.33,.764),.004,"metal",16)
    rod("pen.cap",(-1.45,1.33,.764),(-1.415,1.33,.764),.0045,"steel",16)
    card("coffee-cup", "Glazed ceramic cup", "Hold and drink coffee", "Hollow ceramic wall and joined loop handle; stable foot", "owner-desk", "deferred")
    lathe("coffee-cup.body",[(0,0),(.035,0),(.039,.012),(.042,.092),(.041,.098),(.037,.098),(.036,.02),(0,.014)],(-.27,1.79,.74),"ceramic")
    tube("coffee-cup.handle",[(-.231,1.79,.815),(-.203,1.79,.813),(-.191,1.79,.787),(-.208,1.79,.767),(-.235,1.79,.768)],.006,"ceramic")
    rod("coffee-cup.coffee",(-.27,1.79,.813),(-.27,1.79,.814),.0358,"coffee",48)


def office_chair():
    card("owner-chair", "Five-star upholstered task chair", "Approach, sit at desk, turn and stand", "Cushioned seat/back on steel carrier and gas lift, five cast spokes and twin casters", "room-shell", "interactive")
    x,y=-1.05,.72
    rod("owner-chair.gas-lift",(x,y,.14),(x,y,.37),.027,"steel")
    rod("owner-chair.sleeve",(x,y,.13),(x,y,.28),.041,"dark")
    box("owner-chair.carrier",(.34,.36,.046),(x,y,.386),"metal",.012)
    box("owner-chair.seat",(.50,.48,.08),(x,y,.439),"leather",.038,soft=True)
    box("owner-chair.back-shell",(.48,.045,.49),(x,y-.247,.715),"metal",.020,rotation=(math.radians(8),0,0),soft=True)
    box("owner-chair.back-cushion",(.46,.07,.46),(x,y-.220,.716),"leather",.032,rotation=(math.radians(8),0,0),soft=True)
    tube("owner-chair.back-carrier",[(x,y-.10,.38),(x,y-.28,.40),(x,y-.26,.64)],.022,"metal")
    for side in (-1,1):
        tube(f"owner-chair.arm-{side}",[(x+side*.20,y,.39),(x+side*.292,y,.42),(x+side*.292,y,.62)],.013,"metal")
        box(f"owner-chair.arm-pad-{side}",(.07,.28,.029),(x+side*.292,y+.02,.634),"dark",.013,soft=True)
    for i in range(5):
        a=i*math.tau/5
        dx,dy=math.cos(a),math.sin(a)
        end=(x+dx*.30,y+dy*.30,.081)
        tube(f"owner-chair.spoke-{i}",[(x,y,.14),(x+dx*.15,y+dy*.15,.11),end],.018,"metal")
        rod(f"owner-chair.caster-fork-{i}",end,(end[0],end[1],.047),.012,"metal")
        for side in (-1,1):
            p=Vector((end[0],end[1],.030))+Vector((-dy,dx,0))*(side*.018)
            delta=Vector((-dy,dx,0))*.007
            rod(f"owner-chair.wheel-{i}-{side}",p-delta,p+delta,.030,"rubber",24)


def storage():
    card("library", "Low solid-backed bookcase", "Select and store books", "18 mm veneered sides, 24 mm shelves, 6 mm back, floor plinth and wall restraints", "room-shell")
    cx,cy=-2.98,.15
    for key,size,pos in [("back",(.006,1.85,1.55),(-3.127,cy,.83)),("bottom",(.30,1.85,.024),(cx,cy,.10)),
        ("top",(.30,1.85,.024),(cx,cy,1.62)),("side-south",(.30,.018,1.52),(cx,-.766,.86)),("side-north",(.30,.018,1.52),(cx,1.066,.86)),
        ("plinth",(.27,1.80,.088),(-2.99,cy,.044))]:
        box(f"library.{key}",size,pos,"wood",.001)
    for i,z in enumerate((.48,.86,1.24)):
        box(f"library.shelf-{i}",(.292,1.814,.024),(-2.976,.15,z),"wood",.001)
    random.seed(24)
    index=0
    for shelf,bottom in enumerate((.112,.492,.872,1.252)):
        for j in range(5):
            index+=1
            key=f"book-{index:02d}"
            card(key,"Hardbound reference book","Read or shelve","Bound paper block between two cloth boards", "library", "deferred")
            h=.225+random.random()*.052
            y=-.65+j*.12
            color=("paper","sage","book-red","dark","paint")[(index+2)%5]
            box(f"{key}.pages",(.205,.030,h-.007),(-2.982,y,bottom+h/2),"paper",.0005)
            box(f"{key}.spine",(.007,.036,h),(-2.876,y,bottom+h/2),color,.0015)
            for s in (-1,1):
                box(f"{key}.board-{s}",(.218,.0025,h),(-2.98,y+s*.017,bottom+h/2),color,.0007)
    card("storage-cabinet","Board-built storage cabinet","Store supplies behind doors and on open shelf","18 mm carcass, 22 mm shelves and doors, hinges/pulls, recessed floor plinth", "room-shell", "deferred")
    x,y=1.70,2.30
    for key,size,pos in [("back",(1.15,.006,1.58),(x,2.505,.87)),("base",(1.15,.42,.022),(x,y,.09)),("top",(1.15,.42,.022),(x,y,1.67)),
        ("side-left",(.018,.42,1.58),(x-.566,y,.88)),("side-right",(.018,.42,1.58),(x+.566,y,.88)),
        ("plinth",(1.08,.34,.079),(x,y+.02,.0395)),("middle",(1.114,.40,.022),(x,y,.84)),("shelf",(1.114,.40,.022),(x,y,1.245))]:
        box(f"storage-cabinet.{key}",size,pos,"wood",.001)
    for side in (-1,1):
        dx=x+side*.28
        box(f"storage-cabinet.door-{side}",(.551,.021,.715),(dx,2.077,.47),"paint",.0015)
        for index,z in enumerate((.24,.70)):
            box(f"storage-cabinet.hinge-{side}-{index}",(.026,.018,.060),(x+side*.555,2.084,z),"steel",.001)
        tube(f"storage-cabinet.pull-{side}",[(x+side*.06,2.063,.44),(x+side*.06,2.035,.44),(x+side*.06,2.035,.57),(x+side*.06,2.063,.57)],.004,"metal")


def reading():
    card("reading-rug","Flat woven wool rug","Warm footing in reading zone","Bound woven textile lying directly on floor", "room-shell")
    box("reading-rug.woven-body",(1.85,1.80,.012),(-1.63,-1.26,.006),"cloth",.006)
    card("reading-chair","Timber-frame upholstered lounge chair","Sit and read, then stand into open central area","Timber legs and aprons support upholstered seat/back; armrests join uprights", "reading-rug", "passive")
    x,y=-2.0,-1.28
    for side in (-1,1):
        sx=x+side*.33
        for end,dy in (("front",.24),("rear",-.26)):
            rod(f"reading-chair.leg-{side}-{end}",(sx+side*.028,y+dy,.012),(sx,y+dy,.42),.024,"wood")
        box(f"reading-chair.side-rail-{side}",(.033,.59,.085),(sx,y,.345),"wood",.004)
        rod(f"reading-chair.arm-post-{side}",(sx,y+.19,.365),(sx,y+.19,.60),.020,"wood")
        box(f"reading-chair.armrest-{side}",(.065,.65,.034),(sx,y,.612),"wood",.009)
        rod(f"reading-chair.back-stile-{side}",(sx,y-.27,.35),(sx,y-.39,.93),.022,"wood")
    for i,dy in enumerate((-.23,.22)):
        box(f"reading-chair.cross-rail-{i}",(.66,.035,.06),(x,y+dy,.35),"wood",.004)
    box("reading-chair.seat-deck",(.63,.55,.012),(x,y,.378),"wood",.002)
    box("reading-chair.cushion",(.59,.54,.10),(x,y,.434),"cloth",.045,soft=True)
    box("reading-chair.plywood-back",(.64,.018,.51),(x,y-.350,.693),"wood",.007,rotation=(math.radians(11),0,0))
    box("reading-chair.back",(.59,.115,.51),(x,y-.285,.693),"cloth",.05,rotation=(math.radians(11),0,0),soft=True)
    card("reading-table","Small timber side table","Place a book or drink within reach","22 mm tabletop with three splayed legs and underside mounting block", "reading-rug")
    x,y=-.93,-1.35
    lathe("reading-table.top",[(0,0),(.265,0),(.278,.006),(.278,.023),(.267,.028),(0,.028)],(x,y,.482),"wood")
    for i in range(3):
        a=i*math.tau/3
        rod(f"reading-table.leg-{i}",(x+math.cos(a)*.22,y+math.sin(a)*.22,.015),(x+math.cos(a)*.11,y+math.sin(a)*.11,.49),.022,"wood")
    rod("reading-table.mount",(x,y,.455),(x,y,.495),.115,"wood",32)
    card("reading-lamp","Weighted-base floor reading lamp","Illuminate lap/book; reachable foot switch is deferred","Steel base, tubular stem, supported shade/diffuser, inline foot switch and plugged wall lead", "room-shell", "deferred")
    lathe("reading-lamp.base",[(0,0),(.19,0),(.19,.022),(0,.022)],(-2.75,-1.97,0),"metal")
    tube("reading-lamp.stem",[(-2.75,-1.97,.022),(-2.75,-1.97,1.35),(-2.49,-1.82,1.49)],.012,"metal",handles="VECTOR")
    lathe("reading-lamp.shade",[(.14,0),(.055,.18),(.050,.18),(.135,.003)],(-2.47,-1.81,1.30),"metal")
    rod("reading-lamp.top-cap",(-2.47,-1.81,1.475),(-2.47,-1.81,1.50),.055,"metal")
    rod("reading-lamp.diffuser",(-2.47,-1.81,1.304),(-2.47,-1.81,1.310),.1345,"glow",48)
    tube("reading-lamp.lead",[(-2.75,-1.97,.022),(-2.35,-1.75,.012),(-2.73,-2.05,.012),(-3.11,-1.9,.012),(-3.11,-1.9,.24)],.0035,"dark",handles="VECTOR")
    box("reading-lamp.foot-switch",(.060,.090,.022),(-2.35,-1.75,.011),"dark",.010,soft=True)
    box("reading-lamp.socket-plate",(.034,.090,.090),(-3.143,-1.9,.25),"paint",.003)
    box("reading-lamp.plug",(.030,.030,.042),(-3.116,-1.9,.24),"dark",.006)
    area("light.reading",(-2.47,-1.81,1.29),(-2.0,-1.18,.48),28,(.22,.22),"FFD8AD")


def plant_and_lights():
    card("window-plant","Ficus elastica in ceramic planter","Living plant outside circulation; watering deferred","Hollow pot and soil support woody stems, petioles attach thin curved leaves", "room-shell")
    x,y=-2.60,1.93
    lathe("window-plant.pot",[(0,0),(.17,0),(.225,.39),(.23,.43),(.216,.437),(.205,.414),(.18,.04),(0,.035)],(x,y,0),"ceramic")
    lathe("window-plant.soil",[(0,.035),(.1795,.040),(.20323,.395),(0,.395)],(x,y,0),"soil",48)
    def stem_at(t):
        return Vector((x+.04*t-.08*math.sin(math.pi*t),y+.02*math.sin(math.pi*t),.39+1.19*t))
    tube("window-plant.trunk",[stem_at(t) for t in (0,.25,.5,.75,1)],.016,"bark")
    leaf_count=20
    for i in range(leaf_count):
        h=.57+i*.050
        a=i*2.399
        start=stem_at((h-.39)/1.19)
        maturity=i/(leaf_count-1)
        leaf_length=.29-.08*maturity*maturity
        leaf_width=.083-.018*maturity*maturity
        end=start+Vector((math.cos(a)*.050,math.sin(a)*.050,.018))
        tube(f"window-plant.petiole-{i}",[start,end],.0035,"bark")
        elevation=-.18+.48*maturity
        axis=Vector((math.cos(a)*math.cos(elevation),math.sin(a)*math.cos(elevation),math.sin(elevation)))
        side=Vector((-math.sin(a),math.cos(a),0))
        vertices,faces=[],[]
        for row in range(13):
            t=row/12
            width=leaf_width*math.sin(math.pi*t)**.72
            for col in range(7):
                u=(col-3)/3
                p=end+axis*(leaf_length*t)+side*(width*u)+Vector((0,0,.023*math.sin(math.pi*t)-.014*t*t+.010*u*u))
                vertices.append(tuple(p))
        for row in range(12):
            for col in range(6):
                n=row*7+col
                faces.append((n,n+7,n+8,n+1))
        mesh=bpy.data.meshes.new("leaf")
        mesh.from_pydata(vertices,[],faces)
        mesh.update()
        obj=bpy.data.objects.new("leaf",mesh)
        bpy.context.collection.objects.link(obj)
        finish(f"window-plant.leaf-{i}",obj,"leaf" if i<16 else "young-leaf",True)
        tube(f"window-plant.midrib-{i}",[end,end+axis*(leaf_length*.5)+Vector((0,0,.020)),end+axis*leaf_length+Vector((0,0,-.014))],.0008,"young-leaf")
    card("ceiling-luminaire","Suspended linear work light","Illuminate worktop without blocking view","Extruded housing/diffuser on two cables with ceiling canopy", "room-shell")
    box("ceiling-luminaire.housing",(1.38,.062,.040),(-1.05,1.47,2.48),"metal",.004)
    box("ceiling-luminaire.diffuser",(1.31,.042,.005),(-1.05,1.47,2.457),"glow",.001)
    for i,x in enumerate((-1.54,-.56)):
        rod(f"ceiling-luminaire.cable-{i}",(x,1.47,2.50),(x,1.47,3.085),.002,"steel",12)
        rod(f"ceiling-luminaire.canopy-{i}",(x,1.47,3.08),(x,1.47,3.10),.028,"metal")
    area("light.desk",(-1.05,1.47,2.452),(-1.05,1.55,.74),95,(1.3,.045))
    card("ceiling-downlights","Recessed ceiling downlights","General room illumination","Trim/optic seated in gypsum aperture with hidden housing", "room-shell")
    for i,(x,y) in enumerate(((1.30,-1.55),(.2,.05),(-1.45,-1.1),(1.65,1.40))):
        rod(f"ceiling-downlights.trim-{i}",(x,y,3.077),(x,y,3.099),.055,"metal",32)
        rod(f"ceiling-downlights.optic-{i}",(x,y,3.073),(x,y,3.078),.044,"glow",32)
        area(f"light.down-{i}",(x,y,3.066),(x,y,.2),65,(.12,.12))


def panorama():
    card("exterior-panorama","Photographic coastal view","Look toward a coherent distant landscape", "Optical background sphere; not physical navigable geometry", None)
    material("panorama","FFFFFF",1)
    mat=M["panorama"]
    nodes=mat.node_tree.nodes
    nodes.clear()
    output=nodes.new("ShaderNodeOutputMaterial")
    emission=nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value=.8
    tex=nodes.new("ShaderNodeTexImage")
    tex.image=bpy.data.images.load(str(HERE/"textures/cannon-4k.jpg"),check_existing=True)
    tex.image.pack()
    uv=nodes.new("ShaderNodeUVMap")
    uv.uv_map="UVMap"
    mat.node_tree.links.new(uv.outputs["UV"],tex.inputs["Vector"])
    mat.node_tree.links.new(tex.outputs["Color"],emission.inputs["Color"])
    mat.node_tree.links.new(emission.outputs["Emission"],output.inputs["Surface"])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96,ring_count=48,radius=40,location=(0,0,-3))
    obj=bpy.context.object
    # Preserve native equirectangular UVs; the generic metric projection is for solids.
    uvs=[tuple(v.uv) for v in obj.data.uv_layers.active.data]
    finish("exterior-panorama.sphere",obj,mat,True)
    for loop,uv_value in zip(obj.data.uv_layers.active.data,uvs):
        loop.uv=uv_value
    obj.rotation_euler.z=math.radians(-45)
    obj.visible_shadow=False
    obj["vrataBakePolicy"]="exclude-unlit-background"
    obj["vrataBakeExclusionReason"]="unlit-panorama"
    obj["vrataCollisionPolicy"]="exclude"
    obj["vrataSupportPolicy"]="exclude"
    obj["vrataNavigableBoundsPolicy"]="exclude"
    obj["vrataSourceAssetId"]="cannon-4k"
    obj["vrataPanoramaRadiusM"]=40.0
    obj["vrataPanoramaYawDegrees"]=-45.0
    obj["vrataExcludeFromSceneBounds"]=True


def configure():
    scene=bpy.context.scene
    scene.unit_settings.system="METRIC"
    scene.unit_settings.scale_length=1
    scene["sceneId"]="personal-workspace-v1"
    scene["releaseVersion"]="0.4.0"
    scene["vrataSceneId"]="personal-workspace-v1"
    scene["vrataAuthoringRelease"]="0.4.0"
    scene["qualityOutcome"]="REWORK_REQUIRED"
    scene.render.engine="CYCLES"
    preferences=bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type="CUDA"
    preferences.get_devices()
    for device in preferences.devices:
        device.use=device.type=="CUDA"
    scene.cycles.device="GPU"
    scene.cycles.samples=48
    scene.cycles.use_denoising=True
    scene.cycles.max_bounces=6
    scene.render.resolution_x=1280
    scene.render.resolution_y=800
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.image_settings.color_mode="RGB"
    scene.world.use_nodes=True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value=(.65,.72,.8,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.15
    scene.view_settings.view_transform="AgX"
    scene.view_settings.look="AgX - Medium High Contrast"
    area("light.window",(3.12,.2,1.75),(-1,.6,1.0),750,(2.85,1.55),"E5F0FF")
    camera("entry",(2.45,-2.12,1.60),(-.65,1.25,1.26),65)
    camera("owner-seated",(-1.05,.72,1.20),(-1.05,2.05,1.05),72)
    camera("workspace-detail",(.60,.05,1.45),(-1.12,1.62,.85),54)
    camera("reading",(.70,-.15,1.50),(-2,-1.18,.78),56)
    camera("diagonal-overview",(-.25,-2.20,1.65),(.30,1.05,1.20),72)
    camera("window-near",(1.65,-.35,1.60),(3.3,.28,1.50),58)
    camera("window-seated",(-1.05,.72,1.20),(3.25,.2,1.40),58)
    camera("desk-underneath",(.55,1.15,.35),(-.90,1.72,.57),66)
    camera("shelf-detail",(-1.74,.18,1.06),(-3.0,.22,1.06),48)
    camera("door-detail",(.75,-1.17,1.25),(2.0,-2.52,1.13),52)


def main():
    global OUTPUT
    parser=argparse.ArgumentParser()
    parser.add_argument("--out",required=True)
    parser.add_argument("--views",default="entry,diagonal-overview")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    out=safe_output(args.out)
    out.mkdir(parents=True,exist_ok=True)
    OUTPUT=out
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for name in ("Runtime","Authoring"):
        bpy.context.scene.collection.children.link(bpy.data.collections.new(name))
    material("floor","96704F",image_asset="wood_floor",period=1.7)
    material("wood","795132",image_asset="wood_table_001",period=1.5)
    material("cloth","A29A87",image_asset="fabric_pattern_05",period=.5)
    material("leather","775545",image_asset="leather_red_02",period=.6)
    for key,color,rough,metal in [("plaster","DDD8CD",.90,0),("paint","CDC6B6",.64,0),("metal","272B2A",.44,0),
        ("steel","A8ABAD",.25,.95),("dark","222625",.48,0),("rubber","1D1E1D",.86,0),("keys","424741",.57,0),
        ("paper","E4DCC9",.89,0),("sage","637369",.75,0),("book-red","6F4035",.73,0),("ceramic","CEC4AF",.24,0),
        ("coffee","24150C",.18,0),("soil","24201A",1,0),("bark","62513E",.87,0),("leaf","123015",.38,0),
        ("young-leaf","24491F",.42,0),("screen","333B3B",.30,0)]:
        material(key,color,rough,metal)
    material("glow","FFF0D5",.5,glow=3)
    architecture();desk();office_chair();storage();reading();plant_and_lights();panorama();configure()
    bpy.context.view_layer.update()
    support_module = runpy.run_path(str(HERE / "support_graph.py"))
    SUPPORTS.update(support_module["declare_support_graph"](CARDS))
    for obj in bpy.data.collections["Runtime"].objects:
        coordinates=[obj.matrix_world@Vector(point) for point in obj.bound_box]
        CARDS[obj["vrataObjectId"]].setdefault("measuredParts",[]).append({"name":obj.name,
            "min":[min(p[i] for p in coordinates) for i in range(3)],"max":[max(p[i] for p in coordinates) for i in range(3)],
            "materials":[m.name for m in obj.data.materials]})
    (out/"object-registry.json").write_text(json.dumps({"sceneId":"personal-workspace-v1","releaseVersion":"0.4.0","qualityOutcome":"REWORK_REQUIRED","objects":list(CARDS.values()),"supportGraph":{"rootParts":["room-shell.floor"],"edges":[SUPPORTS[name] for name in sorted(SUPPORTS)]}},indent=2)+"\n")
    (out/"review-views.json").write_text(json.dumps(VIEWS,indent=2)+"\n")
    bpy.context.preferences.filepaths.save_version=0
    safe_output(out/"draft-scene.blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(out/"draft-scene.blend"),check_existing=False)
    for key in args.views.split(","):
        if not key:
            continue
        scene=bpy.context.scene
        scene.camera=bpy.data.objects[f"camera.{key}"]
        scene.render.filepath=str(safe_output(out/f"{key}.png"))
        bpy.ops.render.render(write_still=True)
    print(json.dumps({"objects":len(CARDS),"parts":sum(len(v["parts"]) for v in CARDS.values()),"qualityOutcome":"REWORK_REQUIRED"}))


if __name__=="__main__":
    main()
