import argparse
import hashlib
import json
import math
import runpy
from pathlib import Path
import subprocess
import sys
import tempfile

import bpy
import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parent


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Generate the authored Personal Workspace 0.3.0 panorama.")
    parser.add_argument("--parameters", required=True)
    parser.add_argument("--output")
    parser.add_argument("--decoded-only", action="store_true")
    return parser.parse_args(values)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def smoothstep(low, high, value):
    scaled = np.clip((value - low) / (high - low), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def wrapped_distance(value, center):
    return np.abs((value - center + 0.5) % 1.0 - 0.5)


def palette(parameters, key):
    return np.asarray(parameters["palette"][key], dtype=np.float32) / 255.0


def blend(image, color, alpha):
    image *= 1.0 - alpha[..., None]
    image += color * alpha[..., None]


def spectral_noise(uu, vv, rng, components, minimum_frequency, maximum_frequency):
    field = np.zeros(np.broadcast_shapes(uu.shape, vv.shape), dtype=np.float32)
    total_weight = 0.0
    for index in range(components):
        frequency_x = int(rng.integers(minimum_frequency, maximum_frequency + 1))
        frequency_y = float(rng.uniform(minimum_frequency * 0.45, maximum_frequency * 0.7))
        phase = float(rng.uniform(0.0, math.tau))
        weight = 1.0 / (1.0 + index * 0.34)
        field += np.sin(uu * math.tau * frequency_x + vv * math.tau * frequency_y + phase) * weight
        total_weight += weight
    return field / total_weight * 0.5 + 0.5


def draw_soft_ellipse(image, center_x, center_y, radius_x, radius_y, color, opacity=1.0):
    height, width, _ = image.shape
    x_min = max(0, int(math.floor(center_x - radius_x * 1.1)))
    x_max = min(width, int(math.ceil(center_x + radius_x * 1.1 + 1)))
    y_min = max(0, int(math.floor(center_y - radius_y * 1.1)))
    y_max = min(height, int(math.ceil(center_y + radius_y * 1.1 + 1)))
    if x_min >= x_max or y_min >= y_max:
        return
    xs = (np.arange(x_min, x_max, dtype=np.float32) - center_x) / radius_x
    ys = (np.arange(y_min, y_max, dtype=np.float32) - center_y) / radius_y
    distance = ys[:, None] ** 2 + xs[None, :] ** 2
    alpha = np.clip((1.04 - distance) * 5.5, 0.0, 1.0) * opacity
    region = image[y_min:y_max, x_min:x_max]
    blend(region, np.asarray(color, dtype=np.float32), alpha)


def periodic_profile(u, rng, octaves, base_frequency, roughness):
    profile = np.zeros_like(u, dtype=np.float32)
    total_weight = 0.0
    for octave in range(octaves):
        frequency = base_frequency * (2 ** octave)
        weight = roughness ** octave
        phase = float(rng.uniform(0.0, math.tau))
        profile += np.sin(u * math.tau * frequency + phase) * weight
        profile += np.sin(u * math.tau * (frequency + 1) - phase * 0.63) * weight * 0.35
        total_weight += weight * 1.35
    return profile / total_weight


def paint_city_layer(image, rng, parameters, count, base_v, height_range, width_range, colors, opacity, windows):
    height, width, _ = image.shape
    hero_u = parameters["heroLongitudeU"]
    base_y = int(round(base_v * height))
    palette_values = np.asarray(colors, dtype=np.float32) / 255.0

    districts = parameters["cityDistricts"]
    district_weights = np.asarray([district["weight"] for district in districts], dtype=np.float64)
    district_weights /= district_weights.sum()
    occupied = np.zeros(width, dtype=np.bool_)
    buildings = 0
    attempts = 0
    while buildings < count and attempts < count * 12:
        attempts += 1
        district_index = int(rng.choice(len(districts), p=district_weights))
        district = districts[district_index]
        longitude = hero_u + district["offsetU"] + float(rng.normal(0.0, district["spreadU"]))
        if longitude < 0.01 or longitude > 0.99:
            continue
        center_x = int(round(longitude * width))
        building_width = int(rng.integers(width_range[0], width_range[1] + 1))
        gap = int(rng.integers(1, max(3, building_width // 6 + 1)))
        x0 = max(0, center_x - building_width // 2)
        x1 = min(width, center_x + (building_width + 1) // 2)
        if occupied[max(0, x0 - gap):min(width, x1 + gap)].any():
            continue
        occupied[x0:x1] = True
        height_scale = district["heightScale"] * float(rng.uniform(0.72, 1.24))
        shape_roll = float(rng.random())
        if shape_roll < 0.17:
            height_scale *= float(rng.uniform(0.48, 0.68))
        elif shape_roll > 0.94:
            height_scale *= float(rng.uniform(1.18, 1.42))
        building_height = int(rng.integers(height_range[0], height_range[1] + 1) * height_scale)
        y0 = max(0, base_y - building_height)
        y1 = min(height, base_y + max(2, building_height // 30))
        if x1 - x0 < 3 or y1 - y0 < 5:
            continue
        buildings += 1

        facade = palette_values[int(rng.integers(0, len(palette_values)))] * float(rng.uniform(0.91, 1.08))
        facade = np.clip(facade, 0.0, 1.0)
        roof_style = int(rng.integers(0, 7))
        roof_depth = max(2, min(building_width // 3, building_height // 7))
        local_width = x1 - x0
        columns = np.arange(local_width, dtype=np.float32)
        if roof_style == 0:
            roof_offsets = np.zeros(local_width, dtype=np.int32)
        elif roof_style == 1:
            roof_offsets = np.asarray(np.abs(columns - (local_width - 1) / 2) / max(1, local_width / 2) * roof_depth, dtype=np.int32)
        elif roof_style == 2:
            roof_offsets = np.asarray((columns / max(1, local_width - 1)) * roof_depth, dtype=np.int32)
        elif roof_style == 3:
            roof_offsets = np.where((columns > local_width * 0.2) & (columns < local_width * 0.72), 0, roof_depth).astype(np.int32)
        elif roof_style == 4:
            radius = max(1.0, local_width / 2)
            roof_offsets = np.asarray(roof_depth * (1.0 - np.sqrt(np.clip(1.0 - ((columns - radius) / radius) ** 2, 0.0, 1.0))), dtype=np.int32)
        elif roof_style == 5:
            roof_offsets = np.where(columns < local_width * 0.58, 0, roof_depth).astype(np.int32)
        else:
            roof_offsets = np.where((columns < local_width * 0.26) | (columns > local_width * 0.78), roof_depth, 0).astype(np.int32)

        for local_x, top_offset in enumerate(roof_offsets):
            top = min(y1, y0 + int(top_offset))
            if top >= y1:
                continue
            vertical = np.linspace(1.08, 0.88, y1 - top, dtype=np.float32)[:, None]
            tone = np.clip(facade * vertical, 0.0, 1.0)
            target = image[top:y1, x0 + local_x]
            target[:] = target * (1.0 - opacity) + tone * opacity

        shadow_width = max(1, local_width // 6)
        image[y0:y1, x1 - shadow_width:x1] *= 1.0 - opacity * 0.13
        if building_height > 44 and rng.random() > 0.35:
            band_count = int(rng.integers(1, 4))
            for band_y in rng.integers(y0 + max(4, building_height // 6), y1 - 3, size=band_count):
                image[int(band_y):int(band_y) + 1, x0:x1] *= 1.0 - opacity * float(rng.uniform(0.06, 0.13))
        if roof_style in {3, 6} and building_height > height_range[1] * 0.62:
            antenna_x = x0 + int(local_width * float(rng.uniform(0.36, 0.66)))
            antenna_height = int(rng.integers(5, max(6, building_height // 5)))
            image[max(0, y0 - antenna_height):y0, antenna_x:antenna_x + 1] = facade * 0.72

        if windows and building_width >= 12 and building_height >= 32:
            light = palette(parameters, "cityLight") * float(rng.uniform(0.70, 1.02))
            row_step = int(rng.integers(10, 17))
            column_step = int(rng.integers(7, 13))
            row_start = y0 + int(rng.integers(7, max(8, row_step + 3)))
            column_start = x0 + int(rng.integers(2, max(3, min(6, local_width // 3 + 1))))
            for window_y in range(row_start, y1 - 4, row_step):
                for window_x in range(column_start, x1 - 2, column_step):
                    if rng.random() > 0.69:
                        window_width = 1 if building_width < 20 else 2
                        image[window_y:window_y + 2, window_x:window_x + window_width] = light


def generate(parameters):
    width = parameters["width"]
    height = parameters["height"]
    horizon = parameters["horizonV"]
    hero_u = parameters["heroLongitudeU"]
    rng = np.random.default_rng(parameters["seed"])

    u = (np.arange(width, dtype=np.float32) + 0.5) / width
    v = (np.arange(height, dtype=np.float32) + 0.5) / height
    uu = u[None, :]
    vv = v[:, None]

    zenith = palette(parameters, "skyZenith")
    sky_horizon = palette(parameters, "skyHorizon")
    sky_mix = smoothstep(0.0, horizon, vv) ** 0.72
    image = np.empty((height, width, 3), dtype=np.float32)
    image[:] = zenith
    image *= 1.0 - sky_mix[..., None]
    image += sky_horizon * sky_mix[..., None]

    sun = parameters["sun"]
    sun_distance = np.sqrt((wrapped_distance(uu, sun["u"]) / sun["radius"]) ** 2 + ((vv - sun["v"]) / (sun["radius"] * 1.8)) ** 2)
    sun_core = np.exp(-sun_distance * sun_distance * 3.5)
    sun_glow = np.exp(-sun_distance * 0.72) * 0.24
    blend(image, palette(parameters, "sun"), np.clip(sun_core * 0.9 + sun_glow, 0.0, 0.92))

    cloud_field = spectral_noise(uu, vv, rng, parameters["counts"]["cloudLayers"] * 4, 2, 24)
    cloud_detail = spectral_noise(uu, vv, rng, 7, 18, 64)
    cloud_field = cloud_field * 0.76 + cloud_detail * 0.24
    cloud_band = np.exp(-((vv - 0.275) / 0.135) ** 2)
    cloud_alpha = smoothstep(0.57, 0.72, cloud_field) * cloud_band * 0.48
    blend(image, np.asarray([0.91, 0.93, 0.91], dtype=np.float32), cloud_alpha)
    cloud_shadow = smoothstep(0.48, 0.64, cloud_field) * cloud_band * 0.075
    blend(image, np.asarray([0.47, 0.57, 0.62], dtype=np.float32), cloud_shadow)

    horizon_glow = np.exp(-((vv - horizon) / 0.12) ** 2) * 0.18
    blend(image, palette(parameters, "horizonGlow"), horizon_glow)

    water_mask = np.broadcast_to(vv >= horizon, (height, width))
    water_depth = smoothstep(horizon, 0.74, vv)
    water_color = np.broadcast_to(
        palette(parameters, "waterFar") * (1.0 - water_depth[..., None])
        + palette(parameters, "waterNear") * water_depth[..., None],
        image.shape,
    ).copy()
    water_ripple = (
        np.sin(vv * 930.0 + uu * 29.0)
        + 0.47 * np.sin(vv * 487.0 - uu * 61.0)
        + 0.19 * np.sin(vv * 1710.0 + uu * 113.0)
    ) * 0.5
    water_noise = spectral_noise(uu, vv, rng, 5, 7, 31) - 0.5
    water_color += (water_ripple * 0.72 + water_noise * 0.28)[..., None] * np.asarray([0.016, 0.022, 0.023], dtype=np.float32)
    image[water_mask] = water_color[water_mask]

    far_profile = periodic_profile(u, rng, 5, 1, 0.51)
    far_peak = 0.028 + 0.017 * (far_profile + 1.0)
    far_peak += 0.032 * np.exp(-(wrapped_distance(u, hero_u + 0.29) / 0.12) ** 2)
    far_peak += 0.024 * np.exp(-(wrapped_distance(u, hero_u - 0.27) / 0.16) ** 2)
    far_top = horizon - far_peak
    far_bottom = horizon + 0.018
    far_mask = (vv >= far_top[None, :]) & (vv <= far_bottom)
    far_tone = palette(parameters, "farRidge") * (0.94 + 0.06 * np.cos((u - hero_u) * math.tau))[:, None]
    image[far_mask] = np.broadcast_to(far_tone[None, :, :], image.shape)[far_mask]

    distance_haze = np.exp(-((vv - (horizon - 0.006)) / 0.052) ** 2) * 0.13
    blend(image, palette(parameters, "distanceHaze"), distance_haze)

    paint_city_layer(
        image, rng, parameters, parameters["counts"]["cityBuildingsFar"],
        horizon + 0.014, (16, 54), (6, 17), parameters["cityPalettes"]["far"], 0.42, False,
    )

    near_profile = periodic_profile(u, rng, 6, 2, 0.55)
    near_peak = 0.019 + 0.014 * (near_profile + 1.0)
    near_peak += 0.025 * np.exp(-(wrapped_distance(u, hero_u - 0.24) / 0.14) ** 2)
    near_peak += 0.012 * np.exp(-(wrapped_distance(u, hero_u + 0.055) / 0.052) ** 2)
    near_top = horizon + 0.006 - near_peak
    near_bottom = horizon + 0.032
    near_mask = (vv >= near_top[None, :]) & (vv <= near_bottom)
    image[near_mask] = palette(parameters, "nearRidge")

    paint_city_layer(
        image, rng, parameters, parameters["counts"]["cityBuildingsMid"],
        horizon + 0.025, (30, 104), (11, 32), parameters["cityPalettes"]["mid"], 0.70, True,
    )
    paint_city_layer(
        image, rng, parameters, parameters["counts"]["cityBuildingsNear"],
        horizon + 0.034, (45, 148), (17, 48), parameters["cityPalettes"]["near"], 0.90, True,
    )

    city_mist = np.exp(-((vv - (horizon + 0.019)) / 0.026) ** 2) * 0.065
    blend(image, palette(parameters, "cityMist"), city_mist)

    shoreline = horizon + 0.038 + 0.006 * periodic_profile(u, rng, 4, 4, 0.52)
    shoreline_mask = (vv >= shoreline[None, :]) & (vv <= shoreline[None, :] + 0.006)
    shoreline_tone = np.broadcast_to(palette(parameters, "shoreline")[None, None, :], image.shape)
    image[shoreline_mask] = shoreline_tone[shoreline_mask]

    reflection_band = np.exp(-((uu - hero_u) / 0.105) ** 2) * smoothstep(horizon + 0.02, 0.67, vv) * (1.0 - smoothstep(0.67, 0.76, vv))
    reflection_breakup = 0.5 + 0.5 * np.sin(vv * 1650.0 + uu * 83.0 + 0.3 * np.sin(vv * 290.0))
    reflection_alpha = reflection_band * smoothstep(0.52, 0.92, reflection_breakup) * 0.09
    blend(image, palette(parameters, "sun"), reflection_alpha)

    park_edge = 0.69 + 0.018 * np.sin((u - hero_u) * math.tau * 2.0) + 0.012 * np.sin(u * math.tau * 9.0)
    park_depth = smoothstep(park_edge[None, :], 1.0, vv)
    park_color = palette(parameters, "parkFar") * (1.0 - park_depth[..., None]) + palette(parameters, "parkNear") * park_depth[..., None]
    park_noise = spectral_noise(uu, vv, rng, 11, 24, 170) - 0.5
    park_variation = park_noise[..., None] * np.asarray([0.085, 0.12, 0.055], dtype=np.float32)
    park_color = np.clip(park_color + park_variation, 0.0, 1.0)
    park_mask = vv >= park_edge[None, :]
    image[park_mask] = park_color[park_mask]

    path_progress = smoothstep(0.68, 1.0, vv)
    path_center = hero_u + 0.035 * np.sin(path_progress * math.pi * 1.25)
    path_half_width = 0.011 + 0.135 * path_progress ** 1.5
    path_distance = wrapped_distance(uu, path_center)
    path_alpha = smoothstep(path_half_width + 0.004, path_half_width - 0.004, path_distance) * smoothstep(0.675, 0.73, vv)
    path_tone = palette(parameters, "path") * (1.03 - path_progress[..., None] * 0.18)
    image *= 1.0 - path_alpha[..., None]
    image += path_tone * path_alpha[..., None]

    trunk_color = np.asarray([0.19, 0.14, 0.095], dtype=np.float32)
    leaf_far = np.asarray([0.24, 0.39, 0.26], dtype=np.float32)
    leaf_near = np.asarray([0.12, 0.29, 0.17], dtype=np.float32)
    for _ in range(parameters["counts"]["distantTrees"]):
        x = int(rng.integers(0, width))
        y = int(rng.uniform(0.61, 0.735) * height)
        radius = float(rng.uniform(7.0, 19.0))
        image[y:min(height, y + int(radius * 2.2)), max(0, x - 2):min(width, x + 3)] = trunk_color
        tone = leaf_far * float(rng.uniform(0.82, 1.15))
        draw_soft_ellipse(image, x, y, radius * 1.25, radius, np.clip(tone, 0.0, 1.0), 0.95)
    for _ in range(parameters["counts"]["foregroundTrees"]):
        x = int(rng.integers(0, width))
        y = int(rng.uniform(0.72, 0.97) * height)
        radius = float(rng.uniform(24.0, 74.0)) * (0.7 + (y / height - 0.72) * 1.4)
        trunk_width = max(3, int(radius * 0.11))
        trunk_height = int(radius * 1.4)
        image[y:min(height, y + trunk_height), max(0, x - trunk_width):min(width, x + trunk_width + 1)] = trunk_color * float(rng.uniform(0.75, 1.05))
        tone = leaf_near * float(rng.uniform(0.78, 1.2))
        draw_soft_ellipse(image, x - radius * 0.36, y - radius * 0.12, radius * 0.8, radius * 0.72, np.clip(tone * 0.86, 0.0, 1.0), 0.98)
        draw_soft_ellipse(image, x + radius * 0.3, y - radius * 0.19, radius * 0.78, radius * 0.78, np.clip(tone * 1.08, 0.0, 1.0), 0.98)
        draw_soft_ellipse(image, x, y - radius * 0.55, radius * 0.9, radius * 0.82, np.clip(tone, 0.0, 1.0), 0.98)

    atmospheric = np.clip(np.exp(-((vv - horizon) / 0.095) ** 2) * 0.15, 0.0, 0.15)
    blend(image, palette(parameters, "haze"), atmospheric)

    pixel_x = np.arange(width, dtype=np.uint32)[None, :]
    pixel_y = np.arange(height, dtype=np.uint32)[:, None]
    hashed = pixel_x * np.uint32(374761393) + pixel_y * np.uint32(668265263) + np.uint32(parameters["seed"])
    hashed = (hashed ^ (hashed >> np.uint32(13))) * np.uint32(1274126177)
    hashed ^= hashed >> np.uint32(16)
    micro_variation = ((hashed & np.uint32(65535)).astype(np.float32) / 65535.0 - 0.5)[..., None] * 0.009
    image = np.clip(image + micro_variation, 0.0, 1.0)
    return np.asarray(np.round(image * 255.0), dtype=np.uint8)


def main():
    args = arguments()
    parameters_path = Path(args.parameters).resolve()
    assert_output = runpy.run_path(str(SCRIPT_DIR.parents[1] / "write_safety.py"))["assert_output"]
    output = assert_output(args.output) if args.output else None
    require(parameters_path.parent == SCRIPT_DIR, "parameters_must_be_versioned_with_generator")
    require(args.decoded_only != (output is not None), "select_exactly_one_panorama_output_mode")
    if output is not None:
        require(output.parent == SCRIPT_DIR and output.suffix.lower() in {".jpg", ".jpeg"}, "output_must_be_versioned_jpeg")
    parameters = json.loads(parameters_path.read_text(encoding="utf-8"))
    require(parameters["schemaVersion"] == 1 and parameters["sceneId"] == "personal-workspace-v1", "invalid_panorama_parameters")
    require(parameters["releaseVersion"] == "0.3.0", "invalid_panorama_release")
    runtime = parameters["generatorRuntime"]
    require(tuple(bpy.app.version[:3]) == (4, 5, 12), "blender_version_mismatch")
    build_hash = bpy.app.build_hash.decode("ascii") if isinstance(bpy.app.build_hash, bytes) else str(bpy.app.build_hash)
    require(build_hash == runtime["blenderBuildHash"], "blender_build_hash_mismatch")
    require(np.__version__ == runtime["numpyVersion"], "numpy_version_mismatch")
    pixels = generate(parameters)
    require(pixels.shape == (parameters["height"], parameters["width"], 3), "panorama_shape_mismatch")
    decoded_rgb_sha256 = hashlib.sha256(pixels.tobytes(order="C")).hexdigest()
    expected_decoded_rgb_sha256 = parameters.get("decodedRgbSha256")
    if expected_decoded_rgb_sha256 is not None:
        require(decoded_rgb_sha256 == expected_decoded_rgb_sha256, "panorama_decoded_rgb_sha256_mismatch")
    if args.decoded_only:
        print(json.dumps({
            "decodedRgbSha256": decoded_rgb_sha256,
            "height": parameters["height"],
            "width": parameters["width"],
        }, sort_keys=True))
        return

    version = subprocess.run(["convert", "-version"], check=True, capture_output=True, text=True).stdout.splitlines()[0]
    version = version.removeprefix("Version: ")
    require(version.startswith(runtime["imageMagickVersionPrefix"]), "imagemagick_version_mismatch")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = tempfile.NamedTemporaryFile(prefix="personal-workspace-panorama-", suffix=".ppm", dir=output.parent, delete=False)
    ppm_path = Path(temporary.name)
    try:
        temporary.write(f"P6\n{parameters['width']} {parameters['height']}\n255\n".encode("ascii"))
        temporary.write(pixels.tobytes(order="C"))
        temporary.close()
        command = [
            "convert",
            str(ppm_path),
            "-strip",
            "-colorspace",
            "sRGB",
            "-sampling-factor",
            parameters["chromaSubsampling"],
            "-interlace",
            "Plane" if parameters["progressive"] else "None",
            "-quality",
            str(parameters["quality"]),
            str(output),
        ]
        subprocess.run(command, check=True)
    finally:
        temporary.close()
        ppm_path.unlink(missing_ok=True)
    require(output.read_bytes()[:2] == b"\xff\xd8", "panorama_jpeg_signature_missing")
    require(output.stat().st_size <= parameters["compressedBytesMax"], "panorama_compressed_budget_exceeded")
    print(json.dumps({
        "height": parameters["height"],
        "decodedRgbSha256": decoded_rgb_sha256,
        "output": output.name,
        "sha256": sha256(output),
        "sizeBytes": output.stat().st_size,
        "width": parameters["width"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
