import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { RELEASE_VERSIONS, SCENE_ID, glbStats } from "./lib.mjs";

const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "build"), { recursive: true });
const reports = [];
const inspections = {};
for (const version of RELEASE_VERSIONS) {
  const asset = join(root, "assets", "scenes", SCENE_ID, version, "scene.glb");
  const result = spawnSync("gltf-transform", ["inspect", asset], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`gltf_transform_inspect_failed:${version}:${result.status}:${result.stderr}`);
  reports.push(`===== ${SCENE_ID}@${version} =====\n${result.stdout}`);
  inspections[version] = await glbStats(asset);
}
const report = reports.join("\n");
await writeFile(join(root, "build", "gltf-transform-inspect.txt"), report);
await writeFile(join(root, "build", "inspection.json"), `${JSON.stringify({ sceneId: SCENE_ID, releases: inspections }, null, 2)}\n`);
process.stdout.write(report);
process.stdout.write("Inspection artifacts: build/gltf-transform-inspect.txt, build/inspection.json\n");
