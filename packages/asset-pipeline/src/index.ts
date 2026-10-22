import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { parseBuffer } from "music-metadata";
import { createHash } from "node:crypto";
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;
export async function inspectAsset(bytes: Buffer) {
  if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES)
    throw new Error("Asset size must be 1 byte–16 MiB");
  const type = await fileTypeFromBuffer(bytes);
  if (
    !type ||
    ![
      "image/png",
      "image/webp",
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/ogg",
      "application/ogg",
    ].includes(type.mime)
  )
    throw new Error("Unsupported media content");
  const hash = createHash("sha256").update(bytes).digest("hex");
  let width: number | undefined,
    height: number | undefined,
    durationMs: number | undefined;
  if (type.mime.startsWith("image/")) {
    const image = sharp(bytes, { limitInputPixels: 16777216, failOn: "error" });
    const meta = await image.metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 4096 ||
      meta.height > 4096 ||
      (meta.pages ?? 1) > 1
    )
      throw new Error("Image must be a single frame, at most 4096×4096");
    await image.stats();
    width = meta.width;
    height = meta.height;
  } else {
    const meta = await parseBuffer(
      bytes,
      { mimeType: type.mime },
      { duration: true },
    );
    if (!meta.format.duration || meta.format.duration > 600)
      throw new Error("Audio duration must be 0–600 seconds");
    durationMs = Math.round(meta.format.duration * 1000);
  }
  return {
    hash,
    mime: type.mime,
    ext: type.ext,
    size: bytes.length,
    width,
    height,
    durationMs,
  };
}
