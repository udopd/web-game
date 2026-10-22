import type { Content } from "../../../packages/content-schemas/src/definitions";
import { validateContent } from "../../../packages/content-schemas/src/validate";
import { ContentRegistry } from "../../../packages/content-loader/src/registry";
import {
  buildPack,
  readPack,
  type Manifest,
} from "../../../packages/content-loader/src/packs";
import { db } from "./db";
import { ObjectStorage, sha256 } from "./storage";
import { HttpError } from "./auth";
import type { Prisma } from "../../../generated/prisma/client";
export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export class ContentService {
  private archives = new Map<string, Promise<Map<string, Buffer>>>();
  private cache = new Map<string, ContentRegistry>();
  constructor(readonly storage: ObjectStorage) {}
  async active() {
    const active = await db.activeContent.findUnique({ where: { id: 1 } });
    if (!active) throw new HttpError(503, "No published content");
    return active.version;
  }
  async registry(version: string) {
    let registry = this.cache.get(version);
    if (registry) return registry;
    const pack = await db.pack.findUnique({ where: { version } });
    if (!pack) throw new HttpError(404, "Content version not found");
    registry = new ContentRegistry(pack.content as unknown as Content, version);
    this.cache.set(version, registry);
    if (this.cache.size > 16)
      this.cache.delete(this.cache.keys().next().value!);
    return registry;
  }
  async asset(path: string) {
    const row = await db.asset.findUnique({ where: { key: path } });
    if (!row) throw new HttpError(422, `Missing asset ${path}`);
    const bytes = await this.storage.get(path);
    if (sha256(bytes) !== row.hash)
      throw new Error("Stored asset integrity failure");
    return bytes;
  }
  async export(content: Content, version: string) {
    const errors = validateContent(content);
    if (errors.length) throw new HttpError(422, JSON.stringify(errors));
    return buildPack(content, version, (p) => this.asset(p));
  }
  async publish(content: Content, version: string) {
    const pack = await this.export(content, version);
    await this.storage.put(
      `packs/${pack.hash}.zip`,
      pack.archive,
      "application/zip",
    );
    await db.$transaction(async (tx) => {
      await tx.pack.create({
        data: {
          version,
          hash: pack.hash,
          content: json(content),
          manifest: json(pack.manifest),
          archiveKey: `packs/${pack.hash}.zip`,
        },
      });
      await tx.activeContent.upsert({
        where: { id: 1 },
        create: { id: 1, version },
        update: { version },
      });
    });
    return pack.manifest;
  }
  async publicFile(version: string, path: string) {
    const pack = await db.pack.findUnique({ where: { version } });
    const manifest = pack?.manifest as unknown as Manifest | undefined;
    const declared = manifest?.files.find((f) => f.path === path);
    if (!declared || !pack) throw new HttpError(404, "Unpublished file");
    let pending = this.archives.get(version);
    if (!pending) {
      pending = (async () => {
        const archive = await this.storage.get(pack.archiveKey);
        if (sha256(archive) !== pack.hash)
          throw new Error("Archive integrity failure");
        return (await readPack(archive)).files;
      })();
      this.archives.set(version, pending);
      if (this.archives.size > 4)
        this.archives.delete(this.archives.keys().next().value!);
      pending.catch(() => this.archives.delete(version));
    }
    const bytes = (await pending).get(path);
    if (!bytes || sha256(bytes) !== declared.sha256)
      throw new Error("Content hash mismatch");
    return bytes;
  }
}
