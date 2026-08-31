import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

export const SCENE_ID = "personal-workspace-v1";
export const SOURCE_VERSION = "0.1.0";
export const METADATA_VERSION = "0.1.1";
export const PUBLISHED_BAKED_VERSIONS = Object.freeze(["0.2.0"]);
export const BAKED_RELEASE_VERSION = PUBLISHED_BAKED_VERSIONS.at(-1);
export const VERSION = BAKED_RELEASE_VERSION;
export const BASE_RELEASE_VERSIONS = Object.freeze([SOURCE_VERSION, METADATA_VERSION]);
export const RELEASE_VERSIONS = Object.freeze([...BASE_RELEASE_VERSIONS, ...PUBLISHED_BAKED_VERSIONS]);
export const HISTORICAL_PLATFORM_COMMIT = "9153bb9818a2907fb33ba96375f7b31c1641f12f";
export const METADATA_PLATFORM_COMMIT = "61736f6289f941e290f4fe156f17efdd64ef876b";
export const BAKED_PLATFORM_COMMIT = "c54edb2239d225a71e9b934316f70792b3faafb6";
export const PLATFORM_COMMIT = BAKED_PLATFORM_COMMIT;
export const BLENDER_VERSION = "4.5.12 LTS";
export const BLENDER_BUILD_HASH = "84afd5f785f7";
export const BLENDER_BINARY_SHA256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880";
export const REVIEW_VIEWS = ["entry", "workspace", "reading", "diagonal-overview"];
export const RELEASE_FILES = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
export const SHARED_RELEASE_FILES = ["LICENSES.md", "preview.webp", "scene.glb"];
export const METADATA_RENDER_PROFILE = "neutral-pbr";
export const BAKED_RENDER_PROFILE = "baked-pbr-v1";
export const RENDER_PROFILE = METADATA_RENDER_PROFILE;

export function bakedReleasePaths(version) {
  assert(/^\d+\.\d+\.\d+$/.test(version), `invalid_baked_release_version:${version}`);
  return {
    version,
    evidencePath: `provenance/baked-lightmap-${version}.json`,
    blendPath: "source/review-candidate.blend",
    exportScriptPath: `source/export_baked_release_${version.replaceAll(".", "_")}.py`,
    lightmapPath: `source/baked-lightmap-${version}.png`,
    runtimeReviewPath: `source/runtime-review-${version}.json`,
    runtimeCapturePath: `provenance/runtime-capture-${version}`,
    releasePath: `assets/scenes/${SCENE_ID}/${version}`
  };
}

export const BAKED_RELEASE = Object.freeze(bakedReleasePaths(BAKED_RELEASE_VERSION));
export const RUNTIME_CAPTURE_ARTIFACT_FILES = Object.freeze([
  ...REVIEW_VIEWS.map((view) => `${view}.png`),
  "scene-debug.json",
  "capture-settings.json",
  "preview.webp"
]);
export const RUNTIME_CAPTURE_BINDING_FILE = "capture-binding.json";
export const RUNTIME_CAPTURE_FILES = Object.freeze([...RUNTIME_CAPTURE_ARTIFACT_FILES, RUNTIME_CAPTURE_BINDING_FILE]);

export function bakedReleaseBinaryPaths(versions = PUBLISHED_BAKED_VERSIONS) {
  return versions.flatMap((version) => {
    const paths = bakedReleasePaths(version);
    return [
      paths.lightmapPath,
      ...RUNTIME_CAPTURE_FILES
        .filter((name) => /\.(png|webp)$/i.test(name))
        .map((name) => `${paths.runtimeCapturePath}/${name}`)
    ];
  });
}
export const BLENDER_REVIEW_HORIZONTAL_FOV_DEGREES = Object.freeze({
  entry: 58,
  workspace: 52,
  reading: 55,
  "diagonal-overview": 64
});
export const RUNTIME_REVIEW_ASPECT_RATIO = 16 / 9;
export const SPAWN_YAW = 0.6669082042393105;
export const RIGHTS_APPROVAL_STATUS = "approved-for-public-staging-review";
export const RIGHTS_APPROVED_ON = "2026-08-29";
export const RIGHTS_LICENSE_REF = "LicenseRef-Project-Authored-Public-Staging-Review";
export const RIGHTS_ALLOWED_USES = [
  "staging",
  "public-web-runtime",
  "screenshots",
  "optimization",
  "derivative-builds",
  "publicly-downloadable-scene-bundle-redistribution"
];

export function assert(condition, code) {
  if (!condition) throw new Error(code);
}

export function isReleaseVersionPrefix(versions, fullHistory = RELEASE_VERSIONS) {
  return Array.isArray(versions)
    && Array.isArray(fullHistory)
    && versions.length >= BASE_RELEASE_VERSIONS.length
    && versions.length <= fullHistory.length
    && BASE_RELEASE_VERSIONS.every((version, index) => fullHistory[index] === version)
    && versions.every((version, index) => fullHistory[index] === version);
}

export function nextReleaseVersion(versions, fullHistory = RELEASE_VERSIONS) {
  assert(isReleaseVersionPrefix(versions, fullHistory), "invalid_release_version_prefix");
  return fullHistory[versions.length] ?? null;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalSha256(value) {
  return sha256(stableJson(value));
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

export async function fileRecord(path) {
  const bytes = await readFile(path);
  return { sha256: sha256(bytes), sizeBytes: bytes.length };
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function toRuntimePosition(position) {
  assert(position && [position.x, position.y, position.z].every(Number.isFinite), "invalid_semantic_position");
  return { x: position.x, y: position.y, z: -position.z };
}

export function yawToward(from, to) {
  assert(from && to && [from.x, from.z, to.x, to.z].every(Number.isFinite), "invalid_yaw_positions");
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function horizontalToVerticalFovDegrees(horizontalFovDegrees, aspectRatio = RUNTIME_REVIEW_ASPECT_RATIO) {
  assert(Number.isFinite(horizontalFovDegrees) && horizontalFovDegrees > 0 && horizontalFovDegrees < 180, "invalid_horizontal_fov");
  assert(Number.isFinite(aspectRatio) && aspectRatio > 0, "invalid_fov_aspect_ratio");
  return 2 * Math.atan(Math.tan(horizontalFovDegrees * Math.PI / 360) / aspectRatio) * 180 / Math.PI;
}

export function createMetadataReleaseScene(sourceScene) {
  assert(sourceScene.sceneId === SCENE_ID && sourceScene.version === SOURCE_VERSION, "invalid_metadata_source_scene");
  const spawn = sourceScene.spawnPoints?.find(({ id }) => id === "main");
  const surface = sourceScene.mediaSurfaces?.find(({ surfaceId }) => surfaceId === "workspace-main");
  assert(spawn && surface, "metadata_release_targets_missing");
  const computedYaw = yawToward(spawn.position, surface.transform);
  assert(Math.abs(computedYaw - SPAWN_YAW) < 1e-15, `spawn_yaw_constant_drift:${computedYaw}`);
  return {
    ...sourceScene,
    version: METADATA_VERSION,
    renderProfile: METADATA_RENDER_PROFILE,
    spawnPoints: sourceScene.spawnPoints.map((point) => point.id === "main" ? { ...point, yaw: SPAWN_YAW } : point),
    isCurrent: false
  };
}

export function createBakedReleaseScene(metadataScene) {
  assert(metadataScene.sceneId === SCENE_ID && metadataScene.version === METADATA_VERSION, "invalid_baked_source_scene");
  assert(metadataScene.status === "review"
    && metadataScene.acceptanceStatus === "pending-human-acceptance"
    && metadataScene.visualAcceptanceStatus === "pending-human-acceptance"
    && metadataScene.isCurrent === false
    && metadataScene.publicationReady === false, "invalid_baked_source_review_state");
  return {
    ...metadataScene,
    version: BAKED_RELEASE_VERSION,
    renderProfile: BAKED_RENDER_PROFILE,
    isCurrent: false,
    publicationReady: false
  };
}

function primitiveTriangleCount(primitive) {
  const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
  const mode = primitive.getMode();
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

export async function glbStats(path) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const root = document.getRoot();
  const meshes = root.listMeshes();
  return {
    triangles: meshes.reduce((total, mesh) => total + mesh.listPrimitives().reduce((sum, primitive) => sum + primitiveTriangleCount(primitive), 0), 0),
    objects: root.listNodes().length,
    meshes: meshes.length,
    primitives: meshes.reduce((total, mesh) => total + mesh.listPrimitives().length, 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    scenes: root.listScenes().length
  };
}

export async function bakedMaterialMetadata(path) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  return document.getRoot().listMaterials().map((material) => ({
    name: material.getName(),
    extras: material.getExtras(),
    hasEmissiveTexture: material.getEmissiveTexture() !== null
  }));
}

export async function assertBakedMaterialContract(path) {
  const materials = await bakedMaterialMetadata(path);
  const bakedMaterials = materials.filter(({ extras }) => extras.vrataLightMap === true);
  assert(bakedMaterials.length === 15, `invalid_baked_material_count:${bakedMaterials.length}`);
  assert(bakedMaterials.every(({ extras, hasEmissiveTexture }) => hasEmissiveTexture
    && extras.vrataLightMapIntensity === 4
    && Array.isArray(extras.vrataOriginalEmissive)
    && extras.vrataOriginalEmissive.length === 3
    && extras.vrataOriginalEmissive.every(Number.isFinite)
    && Number.isFinite(extras.vrataOriginalEmissiveIntensity)), "invalid_baked_material_metadata");
  const glass = materials.find(({ name }) => name === "material.window-glass");
  assert(glass && glass.extras.vrataLightMap !== true && glass.hasEmissiveTexture === false, "window_glass_must_remain_unbaked");
}

export async function glbTextureRecords(path) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  return document.getRoot().listTextures().map((texture) => {
    const bytes = texture.getImage();
    assert(bytes !== null, `missing_embedded_texture:${texture.getName()}`);
    return {
      name: texture.getName(),
      mimeType: texture.getMimeType(),
      sha256: sha256(bytes),
      sizeBytes: bytes.length
    };
  });
}

export function pngDimensions(bytes) {
  assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "invalid_png_signature");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function webpDimensions(bytes) {
  assert(bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP", "invalid_webp_signature");
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === "VP8X") {
      return {
        width: 1 + bytes.readUIntLE(start + 4, 3),
        height: 1 + bytes.readUIntLE(start + 7, 3)
      };
    }
    if (type === "VP8 ") {
      assert(bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a, "invalid_vp8_frame");
      return {
        width: bytes.readUInt16LE(start + 6) & 0x3fff,
        height: bytes.readUInt16LE(start + 8) & 0x3fff
      };
    }
    if (type === "VP8L") {
      const bits = bytes.readUInt32LE(start + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    offset = start + length + (length % 2);
  }
  throw new Error("webp_dimensions_not_found");
}
