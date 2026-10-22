import { createHash } from "node:crypto";
import yauzl from "yauzl";
import yazl from "yazl";
import { assertContent } from "../../content-schemas/src/validate";
import {
  CONTENT_PATHS,
  type Content,
  type CollectionName,
} from "../../content-schemas/src/definitions";
import { ENGINE_VERSION, SCHEMA_VERSION } from "../../shared-types/src/index";
import { inspectAsset } from "../../asset-pipeline/src/index";
export type Manifest = {
  schemaVersion: string;
  engineVersion: string;
  contentVersion: string;
  requiredExtensions: { id: string; version: string }[];
  files: { path: string; sha256: string; bytes: number }[];
};
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export function safePackPath(path: string) {
  return (
    path.length <= 240 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !path.includes(":") &&
    path.split("/").every((x) => x !== "." && x !== ".." && x.length > 0) &&
    /^[a-zA-Z0-9_./-]+$/.test(path)
  );
}
export async function buildPack(
  content: Content,
  version: string,
  asset: (path: string) => Promise<Buffer>,
) {
  assertContent(content);
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(version))
    throw new Error("Invalid content version");
  const files = new Map<string, Buffer>();
  for (const [key, path] of Object.entries(CONTENT_PATHS))
    files.set(
      path,
      Buffer.from(JSON.stringify(content[key as CollectionName])),
    );
  const paths = new Set(
    [
      ...content.sprites.items,
      ...content.sounds.items,
      ...content.music.items,
    ].map((x) => x.source),
  );
  for (const path of paths) {
    if (!safePackPath(path)) throw new Error("Unsafe resource path");
    files.set(path, await asset(path));
  }
  await verifyMedia(content, files);
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: version,
    requiredExtensions: content.effects.items
      .filter((e) => e.mode === "custom_extension")
      .map((e) => ({ id: e.extensionId!, version: e.extensionVersion! })),
    files: [...files]
      .map(([path, bytes]) => ({
        path,
        sha256: hash(bytes),
        bytes: bytes.length,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  const zip = new yazl.ZipFile();
  const buffers: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (b) => buffers.push(b));
    zip.outputStream.on("end", () => resolve(Buffer.concat(buffers)));
    zip.outputStream.on("error", reject);
  });
  for (const [path, data] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    zip.addBuffer(data, path, {
      mtime: new Date("2026-01-01T00:00:00Z"),
      mode: 0o100644,
    });
  zip.end();
  const archive = await done;
  return { archive, manifest, hash: hash(archive), files };
}
export async function readPack(bytes: Buffer) {
  if (bytes.length > 64 * 1024 * 1024)
    throw new Error("Archive exceeds 64 MiB");
  const files = new Map<string, Buffer>();
  let expanded = 0;
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => {
        if (err || !zip) return reject(err);
        let stopped = false;
        const fail = (e: unknown) => {
          if (stopped) return;
          stopped = true;
          zip.close();
          reject(e);
        };
        zip.on("error", fail);
        zip.on("end", () => resolve());
        zip.on("entry", (entry) => {
          if (
            !safePackPath(entry.fileName) ||
            files.has(entry.fileName) ||
            files.size >= 4096 ||
            entry.uncompressedSize > 16 * 1024 * 1024 ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 ||
            entry.generalPurposeBitFlag & 1
          )
            return fail(new Error("Unsafe ZIP entry"));
          expanded += entry.uncompressedSize;
          if (
            expanded > 128 * 1024 * 1024 ||
            entry.uncompressedSize > Math.max(1024, entry.compressedSize * 300)
          )
            return fail(new Error("ZIP expansion limit"));
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return fail(e);
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("data", (b) => {
              size += b.length;
              if (size > entry.uncompressedSize)
                return fail(new Error("ZIP size mismatch"));
              chunks.push(b);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              files.set(entry.fileName, Buffer.concat(chunks));
              if (!stopped) zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) throw new Error("Manifest missing");
  const manifest = JSON.parse(manifestBytes.toString()) as Manifest;
  if (
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.engineVersion !== ENGINE_VERSION ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.requiredExtensions)
  )
    throw new Error("Incompatible manifest");
  if (
    typeof manifest.contentVersion !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,80}$/.test(manifest.contentVersion)
  )
    throw new Error("Invalid content version");
  const allowedJson = new Set(Object.values(CONTENT_PATHS));
  const declared = new Set<string>();
  for (const file of manifest.files) {
    if (
      typeof file.path !== "string" ||
      !safePackPath(file.path) ||
      declared.has(file.path) ||
      !Number.isInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("Invalid manifest path");
    if (
      !allowedJson.has(file.path) &&
      !/^assets\/[a-zA-Z0-9_./-]+\.(png|webp|wav|ogg|mp3)$/.test(file.path)
    )
      throw new Error("Unsupported pack file");
    declared.add(file.path);
    const data = files.get(file.path);
    if (!data || data.length !== file.bytes || hash(data) !== file.sha256)
      throw new Error(`Integrity check failed: ${file.path}`);
    if (file.path.startsWith("assets/")) await inspectAsset(data);
  }
  if (files.size !== declared.size + 1)
    throw new Error("Undeclared files in archive");
  const content = Object.fromEntries(
    Object.entries(CONTENT_PATHS).map(([key, path]) => {
      const data = files.get(path);
      if (!data) throw new Error(`Missing collection ${path}`);
      return [key, JSON.parse(data.toString())];
    }),
  );
  assertContent(content);
  const required = new Map(
    content.effects.items
      .filter((e) => e.mode === "custom_extension")
      .map((e) => [e.extensionId, e.extensionVersion]),
  );
  for (const entry of manifest.requiredExtensions)
    if (!entry || required.get(entry.id) !== entry.version)
      throw new Error("Extension manifest mismatch");
  for (const [id, version] of required)
    if (
      !manifest.requiredExtensions.some(
        (e) => e.id === id && e.version === version,
      )
    )
      throw new Error("Extension manifest missing");
  await verifyMedia(content, files);
  return { content, manifest, files };
}
async function verifyMedia(content: Content, files: Map<string, Buffer>) {
  const inspected = new Map<string, Awaited<ReturnType<typeof inspectAsset>>>();
  for (const entry of [
    ...content.sprites.items,
    ...content.sounds.items,
    ...content.music.items,
  ]) {
    const file = files.get(entry.source);
    if (!file) throw new Error(`Missing resource ${entry.source}`);
    if (!inspected.has(entry.source))
      inspected.set(entry.source, await inspectAsset(file));
  }
  for (const sprite of content.sprites.items) {
    const meta = inspected.get(sprite.source)!;
    if (
      !meta.width ||
      !meta.height ||
      sprite.frame.x + sprite.frame.width > meta.width ||
      sprite.frame.y + sprite.frame.height > meta.height
    )
      throw new Error(`Frame outside image: ${sprite.id}`);
  }
  for (const music of content.music.items) {
    const duration = inspected.get(music.source)?.durationMs;
    if (
      !duration ||
      music.loopEndMs > duration ||
      music.loopStartMs >= music.loopEndMs
    )
      throw new Error(`Invalid loop region: ${music.id}`);
  }
}
