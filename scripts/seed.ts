import "dotenv/config";
import { readFile } from "node:fs/promises";
import { loadContent } from "./load-content";
import { inspectAsset } from "../packages/asset-pipeline/src/index";
import { db } from "../apps/server/src/db";
import { ObjectStorage } from "../apps/server/src/storage";
import { ContentService, json } from "../apps/server/src/content-service";
try {
  const content = await loadContent(),
    storage = new ObjectStorage();
  await storage.init();
  const service = new ContentService(storage);
  for (const path of new Set(
    [
      ...content.sprites.items,
      ...content.sounds.items,
      ...content.music.items,
    ].map((x) => x.source),
  )) {
    const bytes = await readFile("content/base-game/" + path),
      info = await inspectAsset(bytes);
    const existing = await db.asset.findUnique({ where: { key: path } });
    if (existing && existing.hash !== info.hash)
      throw new Error(`Refusing to overwrite immutable asset ${path}`);
    if (!existing) {
      await storage.put(path, bytes, info.mime);
      const { ext, ...data } = info;
      await db.asset.create({
        data: { ...data, key: path, name: path.split("/").at(-1)! },
      });
    }
  }
  await db.draft.upsert({
    where: { id: "emberfall-1.1.0" },
    create: {
      id: "emberfall-1.1.0",
      name: "Emberfall · 1.1.0",
      content: json(content),
      ui: {},
    },
    update: {},
  });
  if (!(await db.pack.findUnique({ where: { version: "1.1.0" } })))
    await service.publish(content, "1.1.0");
  console.log("Base content and draft seeded. Existing data preserved.");
} finally {
  await db.$disconnect();
}
