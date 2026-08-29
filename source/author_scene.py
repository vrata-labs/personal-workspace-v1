import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


SCENE_ID = "personal-workspace-v1"


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend-output", required=True)
    parser.add_argument("--review-output-dir", required=True)
    parser.add_argument("--glb-output", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def semantic_position(x, y, z):
    """Map semantic Y-up authoring coordinates into Blender Z-up coordinates."""
    return (x, z, y)


def hex_color(value, alpha=1.0):
    value = value.lstrip("#")
    srgb = tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4))
    linear = tuple(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in srgb)
    return linear + (alpha,)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            datablocks.remove(block)


def create_collections():
    runtime = bpy.data.collections.new("Runtime")
    authoring = bpy.data.collections.new("Authoring")
    bpy.context.scene.collection.children.link(runtime)
    bpy.context.scene.collection.children.link(authoring)
    return runtime, authoring


def move_to_collection(obj, target):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    target.objects.link(obj)


def create_material(name, color, roughness=0.6, metallic=0.0, alpha=1.0, emission=None, emission_strength=0.0):
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.diffuse_color = hex_color(color, alpha)
    material.metallic = metallic
    material.roughness = roughness
    node = material.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = hex_color(color, alpha)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    if "Alpha" in node.inputs:
        node.inputs["Alpha"].default_value = alpha
    if emission and "Emission Color" in node.inputs:
        node.inputs["Emission Color"].default_value = hex_color(emission)
        node.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        material.surface_render_method = "DITHERED"
        material.use_transparency_overlap = False
    return material


def assign_material(obj, material):
    obj.data.materials.append(material)


def add_box(runtime, name, size, center, material, bevel=0.025, yaw=0.0, tilt_x=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=semantic_position(*center))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    obj.rotation_euler = (tilt_x, 0, yaw)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new(name="crafted-edge", type="BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    assign_material(obj, material)
    move_to_collection(obj, runtime)
    obj["sceneId"] = SCENE_ID
    obj["semanticRole"] = name.split(".")[0]
    return obj


def add_cylinder(runtime, name, radius, height, center, material, vertices=20, bevel=0.01):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=semantic_position(*center))
    obj = bpy.context.object
    obj.name = name
    if bevel > 0:
        modifier = obj.modifiers.new(name="crafted-edge", type="BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    assign_material(obj, material)
    move_to_collection(obj, runtime)
    obj["sceneId"] = SCENE_ID
    return obj


def add_cone(runtime, name, radius_bottom, radius_top, height, center, material, vertices=24):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_bottom,
        radius2=radius_top,
        depth=height,
        location=semantic_position(*center),
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    move_to_collection(obj, runtime)
    return obj


def add_sphere(runtime, name, size, center, material, rotation=(0, 0, 0), segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=semantic_position(*center))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0] / 2, size[2] / 2, size[1] / 2)
    obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, material)
    move_to_collection(obj, runtime)
    return obj


def add_tube(runtime, name, points, radius, material):
    curve = bpy.data.curves.new(name=f"{name}.curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new(type="POLY")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*semantic_position(*coordinate), 1)
    obj = bpy.data.objects.new(name, curve)
    runtime.objects.link(obj)
    assign_material(obj, material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def add_area_light(authoring, name, center, target, color, energy, size):
    data = bpy.data.lights.new(name=f"{name}.data", type="AREA")
    data.energy = energy
    data.color = hex_color(color)[:3]
    data.shape = "RECTANGLE"
    data.size = size[0]
    data.size_y = size[1]
    obj = bpy.data.objects.new(name, data)
    authoring.objects.link(obj)
    obj.location = semantic_position(*center)
    direction = Vector(semantic_position(*target)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def add_point_light(authoring, name, center, color, energy, radius):
    data = bpy.data.lights.new(name=f"{name}.data", type="POINT")
    data.energy = energy
    data.color = hex_color(color)[:3]
    data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    authoring.objects.link(obj)
    obj.location = semantic_position(*center)
    return obj


def add_camera(authoring, view_id, position, target, fov_degrees):
    data = bpy.data.cameras.new(name=f"camera.review.{view_id}.data")
    data.lens = 32
    data.sensor_width = 36
    data.angle = math.radians(fov_degrees)
    data.dof.use_dof = False
    obj = bpy.data.objects.new(f"camera.review.{view_id}", data)
    authoring.objects.link(obj)
    obj.location = semantic_position(*position)
    direction = Vector(semantic_position(*target)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def build_architecture(runtime, materials):
    plaster = materials["mineral-plaster"]
    oak = materials["oak"]
    oak_light = materials["oak-light"]
    charcoal = materials["charcoal"]
    glass = materials["glass"]

    add_box(runtime, "architecture.floor-slab", (6.4, 0.12, 5.2), (0, -0.06, 0), oak, 0.015)
    plank_depth = 0.285
    for index in range(18):
        z = -2.42 + index * plank_depth
        material = oak_light if index % 4 in (1, 2) else oak
        add_box(runtime, f"architecture.floor-plank.{index:02d}", (6.25, 0.018, plank_depth - 0.012), (0, 0.012, z), material, 0.004)

    add_box(runtime, "architecture.wall.north", (6.4, 3.1, 0.16), (0, 1.55, 2.6), plaster, 0.018)
    add_box(runtime, "architecture.wall.west", (0.16, 3.1, 5.2), (-3.2, 1.55, 0), plaster, 0.018)
    add_box(runtime, "architecture.wall.south-left", (4.98, 3.1, 0.16), (-0.71, 1.55, -2.6), plaster, 0.018)
    add_box(runtime, "architecture.wall.south-right", (0.48, 3.1, 0.16), (2.96, 1.55, -2.6), plaster, 0.018)
    add_box(runtime, "architecture.wall.south-door-header", (0.94, 0.85, 0.16), (2.25, 2.675, -2.6), plaster, 0.018)

    add_box(runtime, "architecture.wall.east-south", (0.16, 3.1, 1.25), (3.2, 1.55, -1.975), plaster, 0.018)
    add_box(runtime, "architecture.wall.east-north", (0.16, 3.1, 0.85), (3.2, 1.55, 2.175), plaster, 0.018)
    add_box(runtime, "architecture.wall.east-window-sill", (0.16, 0.65, 3.1), (3.2, 0.325, 0.2), plaster, 0.018)
    add_box(runtime, "architecture.wall.east-window-header", (0.16, 0.65, 3.1), (3.2, 2.775, 0.2), plaster, 0.018)
    add_box(runtime, "architecture.ceiling", (6.4, 0.12, 5.2), (0, 3.16, 0), plaster, 0.02)

    for wall, size, center in (
        ("north", (6.22, 0.1, 0.035), (0, 0.08, 2.49)),
        ("west", (0.035, 0.1, 5.02), (-3.09, 0.08, 0)),
        ("south-left", (4.88, 0.1, 0.035), (-0.76, 0.08, -2.49)),
        ("east-south", (0.035, 0.1, 1.16), (3.09, 0.08, -2.0)),
        ("east-north", (0.035, 0.1, 0.76), (3.09, 0.08, 2.2)),
    ):
        add_box(runtime, f"architecture.baseboard.{wall}", size, center, oak_light, 0.012)

    add_box(runtime, "architecture.door", (0.86, 2.16, 0.06), (2.25, 1.08, -2.51), oak, 0.025)
    add_box(runtime, "architecture.door-inset", (0.62, 1.78, 0.035), (2.25, 1.08, -2.46), oak_light, 0.02)
    add_cylinder(runtime, "architecture.door-handle", 0.035, 0.09, (1.93, 1.05, -2.39), charcoal, 16, 0.005)

    add_box(runtime, "architecture.window-glass", (0.035, 1.78, 3.04), (3.17, 1.55, 0.2), glass, 0.0)
    for name, size, center in (
        ("bottom", (0.16, 0.09, 3.18), (3.09, 0.66, 0.2)),
        ("top", (0.16, 0.09, 3.18), (3.09, 2.44, 0.2)),
        ("south", (0.16, 1.86, 0.09), (3.09, 1.55, -1.35)),
        ("north", (0.16, 1.86, 0.09), (3.09, 1.55, 1.75)),
        ("mullion", (0.17, 1.78, 0.065), (3.08, 1.55, 0.2)),
    ):
        add_box(runtime, f"architecture.window-frame.{name}", size, center, charcoal, 0.012)
    add_box(runtime, "architecture.window-sill-oak", (0.36, 0.07, 3.18), (3.0, 0.67, 0.2), oak_light, 0.02)


def build_workspace(runtime, materials):
    oak = materials["oak"]
    oak_light = materials["oak-light"]
    oak_dark = materials["oak-dark"]
    charcoal = materials["charcoal"]
    sage = materials["sage"]
    clay = materials["clay"]
    linen = materials["linen"]
    paper = materials["paper"]
    screen = materials["screen"]

    add_box(runtime, "workspace.wall-panel", (3.35, 1.86, 0.055), (-1.05, 1.48, 2.49), sage, 0.03)
    for index in range(11):
        x = 0.72 + index * 0.105
        add_box(runtime, f"workspace.oak-slat.{index:02d}", (0.045, 2.35, 0.07), (x, 1.44, 2.44), oak_dark if index % 3 == 0 else oak, 0.012)

    add_box(runtime, "furniture.owner-desk.top", (2.78, 0.095, 0.82), (-1.04, 0.78, 1.55), oak_light, 0.035)
    add_box(runtime, "furniture.owner-desk.drawer-carcass", (0.54, 0.68, 0.65), (-2.11, 0.39, 1.59), oak, 0.025)
    for index in range(3):
        y = 0.19 + index * 0.205
        add_box(runtime, f"furniture.owner-desk.drawer-front.{index + 1}", (0.47, 0.17, 0.035), (-2.11, y, 1.245), oak_light, 0.015)
        add_box(runtime, f"furniture.owner-desk.drawer-pull.{index + 1}", (0.18, 0.025, 0.035), (-2.11, y, 1.205), charcoal, 0.008)
    for x in (-0.18, 0.18):
        add_box(runtime, f"furniture.owner-desk.leg.{x:+.2f}", (0.085, 0.68, 0.62), (x, 0.39, 1.58), charcoal, 0.018)
    add_box(runtime, "furniture.owner-desk.cable-tray", (1.2, 0.09, 0.18), (-0.82, 0.64, 1.88), charcoal, 0.015)

    add_box(runtime, "surface.workspace-main.frame", (1.86, 1.10, 0.085), (-1.08, 1.56, 2.47), charcoal, 0.035)
    panel = add_box(runtime, "surface.workspace-main.panel", (1.72, 0.97, 0.025), (-1.08, 1.56, 2.415), screen, 0.012)
    panel["surfaceId"] = "workspace-main"
    add_box(runtime, "surface.workspace-main.ui-column", (0.28, 0.73, 0.008), (-1.68, 1.55, 2.395), sage, 0.008)
    add_box(runtime, "surface.workspace-main.ui-focus", (0.96, 0.42, 0.008), (-0.88, 1.67, 2.392), linen, 0.01)
    add_box(runtime, "surface.workspace-main.ui-footer", (0.96, 0.12, 0.008), (-0.88, 1.29, 2.392), clay, 0.01)
    for index, width in enumerate((0.52, 0.72, 0.43)):
        add_box(runtime, f"surface.workspace-main.ui-line.{index}", (width, 0.025, 0.006), (-0.98, 1.76 - index * 0.1, 2.385), charcoal, 0.003)

    add_box(runtime, "workspace.keyboard-base", (0.62, 0.035, 0.22), (-0.96, 0.845, 1.47), charcoal, 0.018)
    for row in range(3):
        for column in range(8):
            add_box(runtime, f"workspace.keyboard-key.{row}.{column}", (0.052, 0.014, 0.045), (-1.14 + column * 0.055, 0.872, 1.39 + row * 0.052), paper, 0.004)
    add_sphere(runtime, "workspace.mouse", (0.10, 0.045, 0.15), (-0.46, 0.86, 1.5), charcoal)
    add_box(runtime, "workspace.notebook", (0.32, 0.028, 0.24), (-1.72, 0.85, 1.5), clay, 0.012, yaw=-0.12)
    add_box(runtime, "workspace.notebook-page", (0.29, 0.009, 0.21), (-1.72, 0.872, 1.5), paper, 0.008, yaw=-0.12)
    add_cylinder(runtime, "workspace.mug", 0.075, 0.12, (-0.24, 0.86, 1.78), clay, 24, 0.012)
    add_cylinder(runtime, "workspace.mug-opening", 0.057, 0.006, (-0.24, 0.923, 1.78), charcoal, 24, 0.0)
    add_cylinder(runtime, "workspace.pencil-cup", 0.065, 0.15, (-1.8, 0.875, 1.79), charcoal, 20, 0.01)
    for index, x in enumerate((-1.83, -1.80, -1.77)):
        add_cylinder(runtime, f"workspace.pencil.{index}", 0.008, 0.25, (x, 1.04, 1.79), clay if index == 1 else oak_dark, 10, 0.0)

    add_box(runtime, "workspace.private-notes-board", (0.72, 0.58, 0.045), (0.38, 1.46, 2.42), linen, 0.025)
    note_specs = [
        (-0.18, 0.13, 0.18, 0.14, clay),
        (0.07, 0.15, 0.19, 0.16, paper),
        (-0.12, -0.13, 0.24, 0.16, sage),
        (0.16, -0.11, 0.14, 0.18, oak_light),
    ]
    for index, (dx, dy, width, height, material) in enumerate(note_specs):
        add_box(runtime, f"workspace.private-note.{index + 1}", (width, height, 0.008), (0.38 + dx, 1.46 + dy, 2.39), material, 0.006, yaw=(index - 1.5) * 0.025)
        add_cylinder(runtime, f"workspace.private-note-pin.{index + 1}", 0.012, 0.012, (0.38 + dx, 1.46 + dy + height * 0.34, 2.372), charcoal, 12, 0.0)

    add_cone(runtime, "workspace.pendant-shade", 0.23, 0.13, 0.22, (-1.02, 2.45, 1.52), clay)
    add_cylinder(runtime, "workspace.pendant-glow", 0.12, 0.025, (-1.02, 2.33, 1.52), materials["warm-light"], 24, 0.005)
    add_tube(runtime, "workspace.pendant-cord", [(-1.02, 3.12, 1.52), (-1.02, 2.56, 1.52)], 0.012, charcoal)


def build_owner_chair(runtime, materials):
    sage_fabric = materials["sage-fabric"]
    charcoal = materials["charcoal"]
    oak_dark = materials["oak-dark"]

    add_box(runtime, "furniture.owner-chair.seat-shell", (0.58, 0.11, 0.55), (-1.05, 0.48, 0.92), sage_fabric, 0.05)
    add_box(runtime, "furniture.owner-chair.seat-undertray", (0.48, 0.07, 0.44), (-1.05, 0.405, 0.92), charcoal, 0.035)
    add_box(runtime, "furniture.owner-chair.back-shell", (0.58, 0.63, 0.11), (-1.05, 0.79, 0.65), sage_fabric, 0.06, tilt_x=math.radians(-7))
    add_box(runtime, "furniture.owner-chair.back-spine", (0.09, 0.42, 0.08), (-1.05, 0.64, 0.76), charcoal, 0.025, tilt_x=math.radians(-7))
    for side in (-1, 1):
        x = -1.05 + side * 0.33
        add_box(runtime, f"furniture.owner-chair.arm-post.{side:+d}", (0.055, 0.25, 0.055), (x, 0.58, 0.92), charcoal, 0.015)
        add_box(runtime, f"furniture.owner-chair.arm-pad.{side:+d}", (0.10, 0.06, 0.34), (x, 0.72, 0.88), oak_dark, 0.025)
    add_cylinder(runtime, "furniture.owner-chair.pedestal", 0.055, 0.30, (-1.05, 0.24, 0.92), charcoal, 20, 0.01)
    add_cylinder(runtime, "furniture.owner-chair.hub", 0.10, 0.08, (-1.05, 0.09, 0.92), charcoal, 20, 0.012)
    for index in range(5):
        angle = index * math.tau / 5
        dx = math.cos(angle) * 0.24
        dz = math.sin(angle) * 0.24
        add_tube(runtime, f"furniture.owner-chair.spoke.{index}", [(-1.05, 0.09, 0.92), (-1.05 + dx, 0.055, 0.92 + dz)], 0.025, charcoal)
        add_cylinder(runtime, f"furniture.owner-chair.caster.{index}", 0.032, 0.045, (-1.05 + dx, 0.045, 0.92 + dz), charcoal, 12, 0.008)


def build_storage(runtime, materials):
    oak = materials["oak"]
    oak_light = materials["oak-light"]
    charcoal = materials["charcoal"]
    sage = materials["sage"]
    clay = materials["clay"]
    paper = materials["paper"]

    add_box(runtime, "storage.tall-cabinet.carcass", (1.28, 2.32, 0.46), (2.03, 1.17, 2.29), oak, 0.035)
    add_box(runtime, "storage.tall-cabinet.left-door", (0.55, 0.86, 0.035), (1.73, 0.58, 2.03), sage, 0.02)
    add_box(runtime, "storage.tall-cabinet.right-door", (0.55, 0.86, 0.035), (2.33, 0.58, 2.03), clay, 0.02)
    add_box(runtime, "storage.tall-cabinet.open-niche", (1.12, 0.58, 0.035), (2.03, 1.39, 2.04), charcoal, 0.015)
    add_box(runtime, "storage.tall-cabinet.upper-door", (1.12, 0.62, 0.035), (2.03, 1.95, 2.03), oak_light, 0.02)
    for x in (1.76, 2.3):
        add_box(runtime, f"storage.tall-cabinet.pull.{x}", (0.035, 0.22, 0.035), (x, 0.59, 1.99), charcoal, 0.01)
    for index, color in enumerate((paper, clay, sage, paper, oak_light)):
        add_box(runtime, f"storage.niche-book.{index}", (0.09 + index * 0.006, 0.31 - index * 0.012, 0.19), (1.66 + index * 0.14, 1.24 + (index % 2) * 0.02, 2.0), color, 0.008)
    add_cylinder(runtime, "storage.niche-vessel", 0.11, 0.25, (2.48, 1.24, 2.0), clay, 20, 0.012)


def build_reading_zone(runtime, materials):
    oak = materials["oak"]
    oak_light = materials["oak-light"]
    charcoal = materials["charcoal"]
    sage_fabric = materials["sage-fabric"]
    clay = materials["clay"]
    linen = materials["linen"]
    paper = materials["paper"]

    add_box(runtime, "reading.rug", (2.25, 0.035, 1.72), (-1.86, 0.035, -0.48), clay, 0.07, yaw=-0.04)
    for index in range(5):
        add_box(runtime, f"reading.rug-stripe.{index}", (0.055, 0.012, 1.48), (-2.55 + index * 0.34, 0.06, -0.48), linen, 0.012, yaw=-0.04)

    add_box(runtime, "reading.bookshelf.back", (0.08, 1.92, 2.0), (-3.03, 1.09, 0.15), oak, 0.025)
    for z in (-0.78, 1.08):
        add_box(runtime, f"reading.bookshelf.side.{z:+.2f}", (0.34, 1.95, 0.08), (-2.87, 1.09, z), oak_light, 0.02)
    for index, y in enumerate((0.18, 0.58, 0.98, 1.38, 1.78, 2.12)):
        add_box(runtime, f"reading.bookshelf.shelf.{index}", (0.36, 0.07, 1.92), (-2.86, y, 0.15), oak_light, 0.018)
    palette = (paper, clay, sage_fabric, oak_light, charcoal)
    book_index = 0
    for shelf, y in enumerate((0.22, 0.62, 1.02, 1.42, 1.82)):
        for column in range(4):
            z = -0.57 + column * 0.32 + (shelf % 2) * 0.05
            height = 0.22 + ((shelf + column) % 3) * 0.045
            add_box(runtime, f"reading.book.{book_index:02d}", (0.19, height, 0.07), (-2.65, y + height / 2, z), palette[(shelf + column) % len(palette)], 0.007)
            book_index += 1

    add_box(runtime, "reading.chair-seat", (0.78, 0.18, 0.72), (-1.92, 0.42, -0.58), sage_fabric, 0.09, yaw=-0.22)
    add_box(runtime, "reading.chair-back", (0.76, 0.84, 0.18), (-2.02, 0.83, -0.92), sage_fabric, 0.1, yaw=-0.22, tilt_x=math.radians(-9))
    for side in (-1, 1):
        x = -1.92 + side * 0.43
        add_box(runtime, f"reading.chair-arm.{side:+d}", (0.16, 0.43, 0.66), (x, 0.48, -0.58), sage_fabric, 0.07, yaw=-0.22)
        add_cylinder(runtime, f"reading.chair-leg-front.{side:+d}", 0.035, 0.30, (x, 0.17, -0.35), oak, 16, 0.008)
        add_cylinder(runtime, f"reading.chair-leg-back.{side:+d}", 0.035, 0.30, (x, 0.17, -0.83), oak, 16, 0.008)
    add_box(runtime, "reading.chair-cushion", (0.62, 0.12, 0.20), (-1.92, 0.66, -0.86), linen, 0.05, yaw=-0.22)

    add_cylinder(runtime, "reading.side-table-pedestal", 0.045, 0.46, (-0.78, 0.25, -0.92), charcoal, 18, 0.008)
    add_cylinder(runtime, "reading.side-table-base", 0.24, 0.05, (-0.78, 0.05, -0.92), charcoal, 24, 0.012)
    add_cylinder(runtime, "reading.side-table-top", 0.33, 0.07, (-0.78, 0.51, -0.92), oak_light, 32, 0.02)
    add_box(runtime, "reading.side-table-book", (0.34, 0.045, 0.23), (-0.78, 0.57, -0.92), paper, 0.012, yaw=0.18)

    add_cylinder(runtime, "reading.floor-lamp-base", 0.22, 0.045, (-2.54, 0.04, -1.75), charcoal, 24, 0.01)
    add_tube(runtime, "reading.floor-lamp-stem", [(-2.54, 0.06, -1.75), (-2.54, 1.52, -1.75), (-2.25, 1.8, -1.42)], 0.025, charcoal)
    add_cone(runtime, "reading.floor-lamp-shade", 0.29, 0.16, 0.34, (-2.18, 1.72, -1.34), clay)
    add_cylinder(runtime, "reading.floor-lamp-glow", 0.15, 0.025, (-2.18, 1.53, -1.34), materials["warm-light"], 24, 0.005)


def build_window_zone(runtime, materials):
    oak = materials["oak"]
    linen = materials["linen"]
    clay = materials["clay"]
    charcoal = materials["charcoal"]
    leaf = materials["leaf"]
    leaf_light = materials["leaf-light"]
    soil = materials["soil"]

    add_box(runtime, "window.bench-base", (0.52, 0.42, 1.74), (2.82, 0.23, -0.18), oak, 0.04)
    add_box(runtime, "window.bench-cushion", (0.54, 0.12, 1.62), (2.80, 0.49, -0.18), linen, 0.055)
    add_box(runtime, "window.bench-pillow", (0.16, 0.42, 0.44), (2.68, 0.69, 0.26), clay, 0.065, tilt_x=math.radians(-7))

    add_cone(runtime, "window.plant-pot", 0.27, 0.22, 0.42, (2.5, 0.23, 1.86), clay)
    add_cylinder(runtime, "window.plant-soil", 0.215, 0.025, (2.5, 0.45, 1.86), soil, 20, 0.0)
    stems = [
        ((2.5, 0.45, 1.86), (2.42, 1.48, 1.82)),
        ((2.5, 0.45, 1.86), (2.65, 1.34, 1.98)),
        ((2.5, 0.45, 1.86), (2.28, 1.18, 2.02)),
    ]
    for index, (start, end) in enumerate(stems):
        add_tube(runtime, f"window.plant-stem.{index}", [start, end], 0.018, charcoal)
    leaves = [
        (2.35, 0.82, 1.82, -0.35), (2.64, 0.9, 1.9, 0.25), (2.24, 1.08, 1.98, -0.55),
        (2.56, 1.18, 1.77, 0.4), (2.73, 1.28, 2.0, 0.15), (2.34, 1.38, 1.82, -0.25),
        (2.45, 1.56, 1.84, 0.1), (2.7, 1.48, 1.9, 0.35), (2.18, 1.3, 2.0, -0.4),
    ]
    for index, (x, y, z, rotation) in enumerate(leaves):
        add_sphere(runtime, f"window.plant-leaf.{index:02d}", (0.36, 0.10, 0.19), (x, y, z), leaf_light if index % 3 == 0 else leaf, rotation=(rotation, 0, rotation * 0.6), segments=16, rings=8)


def build_ceiling_details(runtime, materials):
    charcoal = materials["charcoal"]
    warm_light = materials["warm-light"]
    add_box(runtime, "lighting.ceiling-track", (3.6, 0.07, 0.08), (0.2, 3.04, 0.2), charcoal, 0.015)
    for index, x in enumerate((-1.15, -0.25, 0.65, 1.55)):
        add_cylinder(runtime, f"lighting.track-head.{index}", 0.075, 0.17, (x, 2.92, 0.2), charcoal, 20, 0.012)
        add_cylinder(runtime, f"lighting.track-lens.{index}", 0.058, 0.018, (x, 2.825, 0.2), warm_light, 20, 0.004)


def configure_scene(authoring):
    scene = bpy.context.scene
    scene["sceneId"] = SCENE_ID
    scene["coordinateAdapter"] = "semantic(x,y,z)->runtime(x,y,-z)"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.2
    scene.eevee.taa_render_samples = 16
    scene.render.fps = 30
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = hex_color("#AFC4C7")
    background.inputs["Strength"].default_value = 0.22

    add_area_light(authoring, "light.window-daylight", (2.92, 2.05, 0.15), (-0.35, 1.05, 0.55), "#D9F0FF", 1150, (3.0, 2.0))
    add_area_light(authoring, "light.workspace-focus", (-1.0, 2.65, 1.45), (-1.0, 0.72, 1.48), "#FFD3A0", 520, (1.3, 0.55))
    add_area_light(authoring, "light.room-fill", (0.2, 2.85, -0.3), (-0.2, 0.5, 0.7), "#FFF0D5", 420, (2.2, 1.6))
    add_point_light(authoring, "light.reading-practical", (-2.18, 1.48, -1.34), "#FFB36A", 180, 0.35)

    views = {
        "entry": ((2.35, 1.58, -1.92), (-0.55, 1.18, 1.22), 58),
        "workspace": ((1.1, 1.48, -0.15), (-1.05, 1.35, 1.93), 52),
        "reading": ((0.55, 1.42, 0.95), (-2.25, 1.0, -0.45), 55),
        "diagonal-overview": ((-1.0, 2.05, -2.15), (0.2, 1.08, 0.72), 64),
    }
    for view_id, (position, target, fov) in views.items():
        add_camera(authoring, view_id, position, target, fov)
    scene.camera = bpy.data.objects["camera.review.entry"]


def build_scene():
    clear_scene()
    runtime, authoring = create_collections()
    materials = {
        "mineral-plaster": create_material("material.mineral-plaster", "#D8D0BF", 0.88),
        "oak": create_material("material.warm-oak", "#9B6035", 0.48),
        "oak-light": create_material("material.oak-honey", "#BC814F", 0.42),
        "oak-dark": create_material("material.oak-shadow", "#6F4129", 0.52),
        "charcoal": create_material("material.charcoal-metal", "#242A29", 0.34, 0.58),
        "sage": create_material("material.muted-sage", "#778879", 0.76),
        "sage-fabric": create_material("material.sage-woven", "#667766", 0.92),
        "clay": create_material("material.soft-clay", "#A96753", 0.72),
        "linen": create_material("material.natural-linen", "#C6B99F", 0.9),
        "paper": create_material("material.warm-paper", "#E8DEC8", 0.86),
        "glass": create_material("material.window-glass", "#BBDDE1", 0.16, 0.0, 0.22),
        "screen": create_material("material.workspace-screen", "#253936", 0.38, 0.05, 1.0, "#6E9F91", 0.28),
        "warm-light": create_material("material.warm-practical-glow", "#FFD09A", 0.35, 0.0, 1.0, "#FFAD5C", 2.5),
        "leaf": create_material("material.plant-leaf", "#405D48", 0.8),
        "leaf-light": create_material("material.plant-leaf-light", "#617B59", 0.82),
        "soil": create_material("material.plant-soil", "#33251D", 0.96),
    }

    build_architecture(runtime, materials)
    build_workspace(runtime, materials)
    build_owner_chair(runtime, materials)
    build_storage(runtime, materials)
    build_reading_zone(runtime, materials)
    build_window_zone(runtime, materials)
    build_ceiling_details(runtime, materials)
    configure_scene(authoring)

    for obj in runtime.all_objects:
        if obj.type == "MESH":
            obj.data.name = f"mesh.{obj.name}"
    return runtime, authoring


def main():
    args = arguments()
    build_scene()
    bpy.context.preferences.filepaths.save_version = 0
    blend_path = Path(args.blend_output)
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), check_existing=False)

    source_dir = Path(__file__).resolve().parent
    if str(source_dir) not in sys.path:
        sys.path.insert(0, str(source_dir))
    from export_scene import export_scene
    from render_review import render_review

    render_review(args.review_output_dir)
    export_scene(args.glb_output)
    print(f"Authored {SCENE_ID}: {len(bpy.data.objects)} Blender objects")


if __name__ == "__main__":
    main()
