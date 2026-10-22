import { loadContent } from "./load-content";
import { buildPack, readPack } from "../packages/content-loader/src/packs";
import { readFile } from "node:fs/promises";
const content = await loadContent();
const pack = await buildPack(content, "validation", (p) =>
  readFile("content/base-game/" + p),
);
await readPack(pack.archive);
console.log(
  `Validated ${Object.keys(content).length} collections, ${pack.manifest.files.length} files, ZIP roundtrip and SHA-256.`,
);
