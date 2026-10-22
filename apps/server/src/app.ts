import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Type as T } from "@sinclair/typebox";
import { db } from "./db";
import { ObjectStorage, sha256 } from "./storage";
import { ContentService, json } from "./content-service";
import { RoomManager } from "./rooms";
import {
  installAuth,
  requireOrigin,
  createSession,
  requireSession,
  HttpError,
  audit,
  authConfig,
} from "./auth";
import {
  DEFAULT_SETTINGS,
  type UserSettings,
} from "../../../packages/shared-types/src/index";
import { validateContent } from "../../../packages/content-schemas/src/validate";
import {
  definitions,
  type Content,
} from "../../../packages/content-schemas/src/definitions";
import { inspectAsset } from "../../../packages/asset-pipeline/src/index";
import { readPack } from "../../../packages/content-loader/src/packs";
import { extensions } from "../../../packages/mutation-extensions/src/generated/index";
import { Simulation } from "../../../packages/simulation/src/simulation";
import { ContentRegistry } from "../../../packages/content-loader/src/registry";
const obj = <P extends import("@sinclair/typebox").TProperties>(p: P) =>
  T.Object(p, { additionalProperties: false });
const id = T.String({ minLength: 1, maxLength: 80 });
const settingsSchema = obj({
  sfxVolume: T.Optional(T.Number({ minimum: 0, maximum: 100 })),
  musicVolume: T.Optional(T.Number({ minimum: 0, maximum: 100 })),
  muteSfx: T.Optional(T.Boolean()),
  muteMusic: T.Optional(T.Boolean()),
  screenShakeStrength: T.Optional(T.Number({ minimum: 0, maximum: 100 })),
  reducedMotion: T.Optional(
    T.Union([T.Literal("auto"), T.Literal("on"), T.Literal("off")]),
  ),
  particleQuality: T.Optional(
    T.Union([T.Literal("low"), T.Literal("medium"), T.Literal("high")]),
  ),
  controls: T.Optional(
    obj({ up: id, down: id, left: id, right: id, interact: id }),
  ),
});
export async function createApp(
  options: { serveStatic?: boolean; logger?: boolean } = {},
) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 20 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    disableRequestLogging: true,
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & {
      statusCode?: number;
      code?: string;
      validation?: unknown;
    };
    const status = err.statusCode ?? (err.code === "P2002" ? 409 : 500);
    if (status >= 500)
      req.log.error(
        { err: { name: err.name, code: err.code, message: err.message } },
        "Request failed",
      );
    reply
      .code(status)
      .send({
        error: status >= 500 ? "Internal server error" : err.message,
        requestId: req.id,
      });
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
  });
  await app.register(multipart, {
    limits: { fileSize: 64 * 1024 * 1024, files: 1, fields: 4, parts: 5 },
  });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  installAuth(app);
  const storage = new ObjectStorage();
  await storage.init();
  const content = new ContentService(storage),
    rooms = new RoomManager(content, (e) => app.log.error(e));
  await rooms.init();
  app.addHook("onClose", async () => {
    await rooms.close();
  });
  app.get("/health", async () => {
    await db.$queryRaw`SELECT 1`;
    await storage.health();
    return { status: "ok", engineVersion: "1.0.0" };
  });
  app.post(
    "/api/register",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
      schema: {
        body: obj({
          name: T.String({
            minLength: 2,
            maxLength: 24,
            pattern: "^[^<>\\x00-\\x1f]+$",
          }),
        }),
      },
    },
    async (req, reply) => {
      requireOrigin(req);
      const { name } = req.body as { name: string };
      const user = await db.user.create({
        data: {
          name: name.trim(),
          settings: json(DEFAULT_SETTINGS),
          facts: { levels: [], biomes: [], bosses: [], maxDepth: 0 },
        },
      });
      const csrf = await createSession("player", reply, user.uid);
      return { uid: user.uid, name: user.name, csrf };
    },
  );
  app.get("/api/users/me", async (req) => {
    const user = await db.user.findUniqueOrThrow({
      where: { uid: req.auth!.uid! },
      include: { unlocks: true },
    });
    return { ...user, csrf: req.auth!.csrf, rooms: rooms.activeFor(user.uid) };
  });
  app.get(
    "/api/users/me/settings",
    async (req) =>
      (await db.user.findUniqueOrThrow({ where: { uid: req.auth!.uid! } }))
        .settings,
  );
  app.patch(
    "/api/users/me/settings",
    { schema: { body: settingsSchema } },
    async (req) => {
      const user = await db.user.findUniqueOrThrow({
        where: { uid: req.auth!.uid! },
      });
      const settings = {
        ...(user.settings as unknown as UserSettings),
        ...(req.body as object),
      };
      await db.user.update({
        where: { uid: user.uid },
        data: { settings: json(settings) },
      });
      return settings;
    },
  );
  app.get("/api/users/me/runs", async (req) =>
    db.participant.findMany({
      where: { uid: req.auth!.uid! },
      include: {
        run: {
          select: {
            id: true,
            status: true,
            contentVersion: true,
            startedAt: true,
            endedAt: true,
          },
        },
      },
      take: 50,
      orderBy: { run: { startedAt: "desc" } },
    }),
  );
  app.post(
    "/api/users/me/progress/reset",
    {
      schema: {
        body: obj({
          confirmation: T.Literal("RESET PROGRESS"),
          requestId: T.String({ format: "uuid" }),
        }),
      },
    },
    async (req) => {
      const uid = req.auth!.uid!,
        body = req.body as { requestId: string };
      if (rooms.activeFor(uid).length)
        throw new HttpError(
          409,
          "Leave active rooms before resetting progress",
        );
      return db.$transaction(async (tx) => {
        const prior = await tx.progressReset.findUnique({
          where: { id: body.requestId },
        });
        if (prior) {
          if (prior.uid !== uid) throw new HttpError(403, "Invalid reset key");
          return { progressVersion: prior.version, resetAt: prior.createdAt };
        }
        await tx.participant.updateMany({
          where: { uid, run: { status: "running" } },
          data: { canResume: false },
        });
        const user = await tx.user.update({
          where: { uid },
          data: {
            progressVersion: { increment: 1 },
            facts: { levels: [], biomes: [], bosses: [], maxDepth: 0 },
          },
        });
        const reset = await tx.progressReset.create({
          data: { id: body.requestId, uid, version: user.progressVersion },
        });
        return { progressVersion: reset.version, resetAt: reset.createdAt };
      });
    },
  );
  app.get(
    "/api/leaderboard",
    {
      schema: {
        querystring: obj({
          sort: T.Optional(T.Union([T.Literal("kills"), T.Literal("depth")])),
        }),
      },
    },
    async (req) => {
      const sort =
        (req.query as { sort?: string }).sort === "kills"
          ? "kills"
          : "maxDepth";
      return db.user.findMany({
        orderBy: [{ [sort]: "desc" }, { createdAt: "asc" }],
        take: 50,
        select: {
          uid: true,
          name: true,
          kills: true,
          maxDepth: true,
          deaths: true,
        },
      });
    },
  );
  app.get("/api/content/current", async () => ({
    version: await content.active(),
  }));
  app.get<{ Params: { version: string } }>(
    "/api/content/:version/manifest",
    async (req, reply) => {
      const pack = await db.pack.findUnique({
        where: { version: req.params.version },
      });
      if (!pack) throw new HttpError(404, "Pack not found");
      reply.header("Cache-Control", "public,max-age=31536000,immutable");
      return pack.manifest;
    },
  );
  app.get<{ Params: { version: string; "*": string } }>(
    "/api/content/:version/files/*",
    async (req, reply) => {
      const path = req.params["*"];
      const data = await content.publicFile(req.params.version, path);
      reply.header("Cache-Control", "public,max-age=31536000,immutable");
      return reply
        .type(
          path.endsWith(".json")
            ? "application/json"
            : path.endsWith(".png")
              ? "image/png"
              : path.endsWith(".webp")
                ? "image/webp"
                : path.endsWith(".wav")
                  ? "audio/wav"
                  : "application/octet-stream",
        )
        .send(data);
    },
  );
  app.get("/api/editor/extensions", async () =>
    extensions.map((x) => ({
      meta: x.meta,
      params: x.params,
      editor: x.editor,
    })),
  );
  app.get("/api/editor/metrics", async () => rooms.metrics);
  app.get("/api/editor/projects", async () =>
    db.draft.findMany({
      select: { id: true, name: true, revision: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  );
  app.post(
    "/api/editor/projects",
    {
      schema: {
        body: obj({ name: T.String({ minLength: 1, maxLength: 100 }) }),
      },
    },
    async (req) => {
      const registry = await content.registry(await content.active());
      const draft = await db.draft.create({
        data: {
          id: randomUUID(),
          name: (req.body as { name: string }).name,
          content: json(registry.content),
          ui: {},
        },
      });
      await audit(req, "project.create", draft.id);
      return draft;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/editor/projects/:id",
    async (req) => {
      const draft = await db.draft.findUnique({ where: { id: req.params.id } });
      if (!draft) throw new HttpError(404, "Project not found");
      return draft;
    },
  );
  app.put<{ Params: { id: string } }>(
    "/api/editor/projects/:id",
    {
      schema: {
        body: obj({
          revision: T.Integer({ minimum: 1 }),
          name: T.String({ minLength: 1, maxLength: 100 }),
          content: T.Object({}, { additionalProperties: true }),
          ui: T.Object({}, { additionalProperties: true }),
        }),
      },
    },
    async (req) => {
      const body = req.body as {
        revision: number;
        name: string;
        content: Content;
        ui: object;
      };
      const result = await db.draft.updateMany({
        where: { id: req.params.id, revision: body.revision },
        data: {
          name: body.name,
          content: json(body.content),
          ui: json(body.ui),
          revision: { increment: 1 },
        },
      });
      if (!result.count)
        throw new HttpError(
          409,
          "Draft changed on the server. Reload or export your local changes.",
        );
      await audit(
        req,
        "draft.save",
        req.params.id,
        sha256(JSON.stringify(body.content)),
      );
      return {
        revision: body.revision + 1,
        issues: validateContent(body.content),
      };
    },
  );
  app.post(
    "/api/editor/validate",
    {
      schema: {
        body: obj({ content: T.Object({}, { additionalProperties: true }) }),
      },
    },
    async (req) => ({
      issues: validateContent((req.body as { content: unknown }).content),
    }),
  );
  app.post<{ Params: { id: string } }>(
    "/api/editor/projects/:id/export",
    async (req, reply) => {
      const draft = await db.draft.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      const pack = await content.export(
        draft.content as unknown as Content,
        `draft-${draft.revision}`,
      );
      await audit(req, "draft.export", draft.id, pack.hash);
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename="emberfall-${draft.revision}.zip"`,
        )
        .type("application/zip")
        .send(pack.archive);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/editor/projects/:id/publish",
    {
      schema: {
        body: obj({
          revision: T.Integer({ minimum: 1 }),
          version: T.String({ pattern: "^\\d+\\.\\d+\\.\\d+$" }),
        }),
      },
    },
    async (req) => {
      const body = req.body as { revision: number; version: string };
      const draft = await db.draft.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      if (draft.revision !== body.revision)
        throw new HttpError(409, "Draft revision changed");
      const manifest = await content.publish(
        draft.content as unknown as Content,
        body.version,
      );
      await audit(
        req,
        "content.publish",
        body.version,
        sha256(JSON.stringify(manifest)),
      );
      return { manifest };
    },
  );
  app.get("/api/editor/versions", async () =>
    db.pack.findMany({
      select: { version: true, hash: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  );
  app.post(
    "/api/editor/rollback",
    { schema: { body: obj({ version: id }) } },
    async (req) => {
      const version = (req.body as { version: string }).version;
      await content.registry(version);
      await db.activeContent.update({ where: { id: 1 }, data: { version } });
      await audit(req, "content.rollback", version);
      return { version };
    },
  );
  app.get("/api/editor/assets", async () =>
    db.asset.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
  );
  app.post("/api/editor/assets", async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, "File required");
    const bytes = await file.toBuffer();
    let info;
    try {
      info = await inspectAsset(bytes);
    } catch (e) {
      throw new HttpError(422, (e as Error).message);
    }
    const existing = await db.asset.findFirst({ where: { hash: info.hash } });
    if (existing) return { ...existing, deduplicated: true };
    const key = `assets/${info.hash}.${info.ext}`;
    await storage.put(key, bytes, info.mime);
    const { ext, ...data } = info;
    const asset = await db.asset.create({
      data: { ...data, key, name: file.filename.slice(0, 160) },
    });
    await audit(req, "asset.upload", key, info.hash);
    return asset;
  });
  app.get<{ Querystring: { key: string } }>(
    "/api/editor/asset",
    async (req, reply) => {
      const asset = await db.asset.findUnique({
        where: { key: req.query.key },
      });
      if (!asset) throw new HttpError(404, "Asset not found");
      return reply.type(asset.mime).send(await content.asset(asset.key));
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/editor/projects/:id/import",
    async (req) => {
      const file = await req.file();
      if (!file) throw new HttpError(400, "Archive required");
      let pack;
      try {
        pack = await readPack(await file.toBuffer());
      } catch (e) {
        throw new HttpError(422, (e as Error).message);
      }
      const draft = await db.draft.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      for (const [path, bytes] of pack.files) {
        if (!path.startsWith("assets/")) continue;
        const info = await inspectAsset(bytes),
          existing = await db.asset.findUnique({ where: { key: path } });
        if (existing && existing.hash !== info.hash)
          throw new HttpError(
            409,
            "Asset path already has different immutable content",
          );
        if (!existing) {
          await storage.put(path, bytes, info.mime);
          const { ext, ...data } = info;
          await db.asset.create({
            data: { ...data, key: path, name: path.split("/").at(-1)! },
          });
        }
      }
      const updated = await db.draft.updateMany({
        where: { id: draft.id, revision: draft.revision },
        data: { content: json(pack.content), revision: { increment: 1 } },
      });
      if (!updated.count)
        throw new HttpError(409, "Draft changed during import");
      await audit(req, "draft.import", draft.id);
      return { content: pack.content, revision: draft.revision + 1 };
    },
  );
  app.post(
    "/api/editor/preview",
    {
      config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
      schema: {
        body: obj({
          content: T.Object({}, { additionalProperties: true }),
          campaignId: id,
          characterId: id,
          seed: T.Integer({ minimum: 0, maximum: 4294967295 }),
          ticks: T.Integer({ minimum: 0, maximum: 300 }),
        }),
      },
    },
    async (req) => {
      const body = req.body as {
        content: Content;
        campaignId: string;
        characterId: string;
        seed: number;
        ticks: number;
      };
      const issues = validateContent(body.content);
      if (issues.length) throw new HttpError(422, JSON.stringify(issues));
      const sim = new Simulation(new ContentRegistry(body.content, "preview"), {
        runId: "preview",
        seed: body.seed,
        campaignId: body.campaignId,
        players: [{ id: "preview", characterId: body.characterId }],
      });
      for (let i = 0; i < body.ticks; i++) sim.step();
      return sim.snapshot();
    },
  );
  app.post(
    "/api/rooms",
    { schema: { body: obj({ campaignId: id }) } },
    async (req) =>
      rooms.create(
        req.auth!.uid!,
        (req.body as { campaignId: string }).campaignId,
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/rooms/:id",
    async (req) => rooms.member(req.params.id, req.auth!.uid!).view,
  );
  app.post<{ Params: { id: string } }>("/api/rooms/:id/join", async (req) =>
    rooms.join(req.params.id, req.auth!.uid!),
  );
  app.post<{ Params: { id: string } }>(
    "/api/rooms/:id/ready",
    { schema: { body: obj({ ready: T.Boolean(), characterId: id }) } },
    async (req) => {
      const b = req.body as { ready: boolean; characterId: string };
      return rooms.ready(req.params.id, req.auth!.uid!, b.ready, b.characterId);
    },
  );
  app.post<{ Params: { id: string } }>("/api/rooms/:id/start", async (req) =>
    rooms.start(req.params.id, req.auth!.uid!),
  );
  app.post<{ Params: { id: string } }>(
    "/api/rooms/:id/transfer",
    { schema: { body: obj({ uid: T.String({ format: "uuid" }) }) } },
    async (req) =>
      rooms.transfer(
        req.params.id,
        req.auth!.uid!,
        (req.body as { uid: string }).uid,
      ),
  );
  app.post<{ Params: { id: string } }>("/api/rooms/:id/leave", async (req) =>
    rooms.leave(req.params.id, req.auth!.uid!),
  );
  app.post<{ Params: { id: string } }>(
    "/api/rooms/:id/kick",
    { schema: { body: obj({ uid: T.String({ format: "uuid" }) }) } },
    async (req) =>
      rooms.leave(
        req.params.id,
        req.auth!.uid!,
        (req.body as { uid: string }).uid,
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/ws/rooms/:id",
    {
      websocket: true,
      preValidation: async (req) => {
        requireOrigin(req);
        await requireSession(req, "player", false);
        rooms.member(req.params.id, req.auth!.uid!);
      },
    },
    (socket, req) =>
      rooms.attach(req.params.id, req.auth!.uid!, socket, req.auth!.hash),
  );
  if (options.serveStatic !== false) {
    const gameRoot = resolve("dist/game"),
      editorRoot = resolve("dist/editor");
    if (existsSync(gameRoot)) {
      await app.register(staticFiles, {
        root: gameRoot,
        prefix: "/",
        wildcard: true,
      });
    }
    if (existsSync(editorRoot)) {
      await app.register(staticFiles, {
        root: editorRoot,
        prefix: "/editor/",
        decorateReply: false,
      });
      app.get("/editor", (_, reply) =>
        reply.sendFile("index.html", editorRoot),
      );
    }
    app.get("/editor/login", (_, reply) =>
      reply.type("text/html").send(loginHtml),
    );
  }
  return { app, rooms, content };
}
const loginHtml = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Emberfall · Editor access</title><style>body{margin:0;background:#111a22;color:#eaf1f2;font:16px system-ui;display:grid;place-items:center;min-height:100vh}form{width:min(360px,85vw);padding:40px;background:#1c2732;border:1px solid #34434e;border-radius:16px}h1{font-size:28px}label{display:block}input,button{box-sizing:border-box;width:100%;padding:12px;margin:12px 0;border-radius:8px;border:1px solid #536779;background:#111a22;color:inherit}button{background:#a5d980;color:#182330;font-weight:700;cursor:pointer}small,a{color:#a5b8c3}p[role]{color:#e78a90}</style><form><small>EMBERFALL / CONTENT STUDIO</small><h1>Вход в редактор</h1><label for="token">Токен администратора</label><input id="token" name="token" type="password" autocomplete="off" required><button>Войти</button><p role="alert"></p><a href="/">Вернуться в игру</a></form><script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const field=document.querySelector('input'),button=document.querySelector('button');button.disabled=true;try{const r=await fetch('/api/editor/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:field.value})});field.value='';if(!r.ok)throw new Error((await r.json()).error);location.href='/editor';}catch(err){document.querySelector('[role=alert]').textContent=err.message;}finally{button.disabled=false;}})</script></html>`;
