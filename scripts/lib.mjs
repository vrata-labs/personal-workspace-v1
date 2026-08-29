import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

export const SCENE_ID = "personal-workspace-v1";
export const VERSION = "0.1.0";
export const PLATFORM_COMMIT = "9153bb9818a2907fb33ba96375f7b31c1641f12f";
export const REVIEW_VIEWS = ["entry", "workspace", "reading", "diagonal-overview"];
export const RELEASE_FILES = ["LICENSES.md", "preview.webp", "scene.glb", "scene.json"];
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
