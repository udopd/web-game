import {
  CONTENT_PATHS,
  type Content,
} from "../../content-schemas/src/definitions";
import { ContentRegistry } from "./registry";
type BrowserManifest = {
  schemaVersion: string;
  engineVersion: string;
  contentVersion: string;
  files: { path: string; sha256: string; bytes: number }[];
};
export async function loadPublishedContent(
  version: string,
  onProgress: (loaded: number, total: number) => void = () => {},
) {
  const response = await fetch(
    `/api/content/${encodeURIComponent(version)}/manifest`,
  );
  if (!response.ok) throw new Error("Unable to load content manifest");
  const manifest = (await response.json()) as BrowserManifest;
  if (manifest.schemaVersion !== "1.0.0" || manifest.engineVersion !== "1.0.0")
    throw new Error("Unsupported content version");
  const files = new Map<string, Uint8Array>();
  let loaded = 0;
  const queue = [...manifest.files];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const file = queue.shift()!;
        const r = await fetch(
          `/api/content/${encodeURIComponent(version)}/files/${file.path}`,
        );
        if (!r.ok) throw new Error(`Unable to load ${file.path}`);
        const bytes = await r.arrayBuffer(),
          digest = await crypto.subtle.digest("SHA-256", bytes),
          hex = Array.from(new Uint8Array(digest), (x) =>
            x.toString(16).padStart(2, "0"),
          ).join("");
        if (hex !== file.sha256 || bytes.byteLength !== file.bytes)
          throw new Error(`Integrity mismatch ${file.path}`);
        files.set(file.path, new Uint8Array(bytes));
        onProgress(++loaded, manifest.files.length);
      }
    }),
  );
  const content = Object.fromEntries(
    Object.entries(CONTENT_PATHS).map(([key, path]) => [
      key,
      JSON.parse(new TextDecoder().decode(files.get(path))),
    ]),
  ) as Content;
  const urls = new Map<string, string>();
  for (const [path, data] of files)
    if (path.startsWith("assets/"))
      urls.set(path, URL.createObjectURL(new Blob([data as BlobPart])));
  return {
    registry: new ContentRegistry(content, version),
    assetUrl: (path: string) => urls.get(path) ?? "",
    dispose: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    },
  };
}
