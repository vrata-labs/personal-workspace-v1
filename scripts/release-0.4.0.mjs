export const CURRENT_RELEASE_VERSION = "0.4.0";
export const CURRENT_PLATFORM_COMMIT = "c6343de81b038b7937addac44c24fa7c46adf341";
export const CURRENT_QUALITY_OUTCOME = "REWORK_REQUIRED";
export const CURRENT_RELEASE_PATH = "assets/scenes/personal-workspace-v1/0.4.0";
export const CURRENT_SOURCE_PATH = "source/releases/0.4.0";
export const CURRENT_PROVENANCE_PATH = "provenance/releases/0.4.0";
export const CURRENT_RUNTIME_CAPTURE_PATH = "provenance/runtime-capture-0.4.0";

export const CURRENT_HASHES = Object.freeze({
  authoredBlend: "f227fb73135898b1fc318c50795aadc011bfdad1acfafda7ce4ec2cc8d2d5f7d",
  bakedBlend: "2315b0eb4df823ae7badb644a0a9f00eb083331547dda6773a56b64a4c9468d9",
  atlas: "7f772b66a2514b7f31d234ad885ba3eb4a9ba0df590ade62c5e19af219de8916",
  rawGlb: "5943b9b47323308300053de7dfb36653e0baae5d36827e2182978ac1281647e9",
  finalGlb: "ae45bdab2aeec5c8c66e7957c13ca769f356d17df86db13660461a9825ca64b9",
  sceneManifest: "5016a7303092a84e0e7283abc0bfa2666dd47d5f5d69c53b6a7fd1150aacd2c6",
  preview: "a41e5bd676e8d3cdeff8cb89d072fe9b9b8683b38860ef63b8be2cdcc04fdb21",
  licenses: "45abac823cb27361a82ac6bf417ebbec7738d7c7d8e7186f4ecfd69b3d335ef1",
  registry: "adf8edbb397ae14a97d841ceeaabc39bbe6599edac82e32a249404a863f556c1",
  geometryMeasurements: "733d0f2594809be7050067ef45eabd137c6816f3ba27180fdecd8efb009f2ce0",
  supportMeasurements: "482ec7fdb1ba4cdcbecd09036a0dd8cdac9962b474a49a15d05d616010e446ad"
});

export const CURRENT_RELEASE_FILES = Object.freeze(["LICENSES.md", "preview.webp", "scene.glb", "scene.json"]);
export const CURRENT_STATS = Object.freeze({
  triangles: 87888,
  objects: 397,
  meshes: 397,
  primitives: 397,
  materials: 23,
  textures: 14,
  animations: 0,
  scenes: 1
});
export const CURRENT_REVIEW_VIEWS = Object.freeze([
  "entry",
  "owner-seated",
  "workspace-detail",
  "reading",
  "diagonal-overview",
  "window-near",
  "window-seated",
  "desk-underneath",
  "shelf-detail",
  "door-detail"
]);
export const CURRENT_REVIEW_FILES = Object.freeze([
  ...CURRENT_REVIEW_VIEWS.map((view) => `${view}.png`),
  "source-render-settings.json"
]);
export const CURRENT_CLEAN_CAPTURE_FILES = Object.freeze([
  "capture-settings.json",
  "clean-spawn.png",
  "compare-detail-views.png",
  "compare-role-views.png",
  ...CURRENT_REVIEW_VIEWS.map((view) => `${view}.png`),
  "scene-debug.json"
]);
export const CURRENT_NORMAL_CAPTURE_FILES = Object.freeze([
  "normal-media.png",
  "normal-owner-desk-seat.png",
  "normal-product-evidence.json",
  "normal-spawn.png"
]);

export const POLY_HAVEN_LICENSE_URL = "https://polyhaven.com/license";
export const POLY_HAVEN_INFO_URLS = Object.freeze([
  "https://api.polyhaven.com/info/wood_floor",
  "https://api.polyhaven.com/info/wood_table_001",
  "https://api.polyhaven.com/info/fabric_pattern_05",
  "https://api.polyhaven.com/info/leather_red_02"
]);
export const POLY_HAVEN_SOURCE_URLS = Object.freeze([
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_diff_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_nor_gl_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_rough_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_diff_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_nor_gl_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_rough_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_05/fabric_pattern_05_col_01_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_05/fabric_pattern_05_nor_gl_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_05/fabric_pattern_05_rough_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leather_red_02/leather_red_02_coll1_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leather_red_02/leather_red_02_nor_gl_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leather_red_02/leather_red_02_rough_1k.jpg",
  "https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/cannon.jpg"
]);
