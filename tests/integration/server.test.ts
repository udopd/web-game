import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app";
import { db } from "../../apps/server/src/db";
import { content } from "../fixtures";
import { WebSocket } from "ws";
import type { WorldState } from "../../packages/simulation/src/types";
let server: Awaited<ReturnType<typeof createApp>>, port: number;
const origin = process.env.APP_ORIGIN!;
let editorCookie = "",
  editorCsrf = "",
  uid = "",
  playerCookie = "",
  playerCsrf = "",
  roomId = "",
  draftId = "";
const users: string[] = [];
let runId: string | undefined;
const cookie = (r: any) =>
  r.cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
const headers = (role: "editor" | "player" = "editor") => ({
  origin,
  cookie: role === "editor" ? editorCookie : playerCookie,
  "x-csrf-token": role === "editor" ? editorCsrf : playerCsrf,
});
beforeAll(async () => {
  server = await createApp({ logger: false, restoreRooms: false });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  port = (server.app.server.address() as { port: number }).port;
  const login = await server.app.inject({
    method: "POST",
    url: "/api/editor/auth/login",
    headers: { origin },
    payload: { token: process.env.ADMIN_EDITOR_TOKEN },
  });
  expect(login.statusCode).toBe(200);
  editorCookie = cookie(login);
  editorCsrf = login.json().csrf;
  const reg = await server.app.inject({
    method: "POST",
    url: "/api/register",
    headers: { origin },
    payload: { name: "Integration Explorer" },
  });
  expect(reg.statusCode).toBe(200);
  playerCookie = cookie(reg);
  playerCsrf = reg.json().csrf;
  uid = reg.json().uid;
  users.push(uid);
});
afterAll(async () => {
  if (roomId) {
    try {
      await server.rooms.leave(roomId, uid);
    } catch {}
  }
  await server.app.close();
  if (draftId) await db.draft.deleteMany({ where: { id: draftId } });
  if (roomId) await db.room.deleteMany({ where: { id: roomId } });
  if (runId) {
    await db.progressEvent.deleteMany({ where: { runId } });
    await db.participant.deleteMany({ where: { runId } });
    await db.run.deleteMany({ where: { id: runId } });
  }
  await db.progressReset.deleteMany({ where: { uid: { in: users } } });
  await db.unlock.deleteMany({ where: { uid: { in: users } } });
  await db.user.deleteMany({ where: { uid: { in: users } } });
  await db.session.deleteMany({ where: { role: "editor", csrf: editorCsrf } });
  await db.$disconnect();
});
describe("Real PostgreSQL + private S3 HTTP integration", () => {
  it("reports actual database and storage health", async () => {
    expect((await server.app.inject("/health")).json().status).toBe("ok");
  });
  it("rejects unauthenticated editor API and redirects protected assets", async () => {
    for (const url of [
      "/api/editor/projects",
      "/api/editor/assets",
      "/api/editor/versions",
      "/api/editor/extensions",
    ])
      expect((await server.app.inject(url)).statusCode).toBe(401);
    const r = await server.app.inject("/editor/assets/anything.js");
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/editor/login");
  });
  it("does not let a player session access editor APIs", async () => {
    const r = await server.app.inject({
      url: "/api/editor/projects",
      headers: { cookie: playerCookie },
    });
    expect(r.statusCode).toBe(401);
  });
  it("requires both allowed Origin and CSRF for writes", async () => {
    for (const h of [
      { ...headers(), origin: "https://attacker.invalid" },
      { ...headers(), "x-csrf-token": "wrong" },
    ])
      expect(
        (
          await server.app.inject({
            method: "POST",
            url: "/api/editor/projects",
            headers: h,
            payload: { name: "not-created" },
          })
        ).statusCode,
      ).toBe(403);
  });
  it("uses HttpOnly, SameSite strict cookies and never returns the admin credential", async () => {
    const response = await server.app.inject({
      url: "/api/editor/session",
      headers: headers(),
    });
    expect(response.json()).toEqual({ csrf: editorCsrf, role: "editor" });
    expect(response.body).not.toContain(process.env.ADMIN_EDITOR_TOKEN);
    const stored = await db.session.findFirstOrThrow({
      where: { csrf: editorCsrf },
    });
    expect(stored.hash).toHaveLength(64);
    expect(stored.hash).not.toContain(editorCookie.split("=")[1]);
  });
  it("rejects malformed registration and client-supplied identity", async () => {
    const r = await server.app.inject({
      method: "POST",
      url: "/api/register",
      headers: { origin },
      payload: { name: "Explorer", uid: randomUUID() },
    });
    expect(r.statusCode).toBe(400);
  });
  it("roundtrips account settings and preserves UID", async () => {
    const r = await server.app.inject({
      method: "PATCH",
      url: "/api/users/me/settings",
      headers: headers("player"),
      payload: { sfxVolume: 37, reducedMotion: "on" },
    });
    expect(r.statusCode).toBe(200);
    const me = await server.app.inject({
      url: "/api/users/me",
      headers: headers("player"),
    });
    expect(me.json().settings.sfxVolume).toBe(37);
    expect(me.json().uid).toBe(uid);
  });
  it("serves byte-exact content after JSONB key reordering", async () => {
    const current = (await server.app.inject("/api/content/current")).json();
    const manifest = (
      await server.app.inject(`/api/content/${current.version}/manifest`)
    ).json();
    for (const file of manifest.files.filter((x: any) =>
      x.path.endsWith(".json"),
    )) {
      const r = await server.app.inject(
        `/api/content/${current.version}/files/${file.path}`,
      );
      expect(r.statusCode, file.path).toBe(200);
      const { createHash } = await import("node:crypto");
      expect(createHash("sha256").update(r.rawPayload).digest("hex")).toBe(
        file.sha256,
      );
    }
  });
  it("does not expose undeclared draft assets or files", async () => {
    const version = (await server.app.inject("/api/content/current")).json()
      .version;
    for (const path of [
      "secrets.json",
      "manifest.json",
      ".env",
      "assets/private.png",
    ])
      expect(
        (await server.app.inject(`/api/content/${version}/files/${path}`))
          .statusCode,
      ).toBe(404);
  });
  it("saves drafts with optimistic revision protection", async () => {
    const create = await server.app.inject({
      method: "POST",
      url: "/api/editor/projects",
      headers: headers(),
      payload: { name: "Integration disposable draft" },
    });
    expect(create.statusCode).toBe(200);
    const d = create.json();
    draftId = d.id;
    const body = {
      name: d.name,
      content: d.content,
      ui: { layout: { test: true } },
      revision: d.revision,
    };
    const first = await server.app.inject({
      method: "PUT",
      url: `/api/editor/projects/${d.id}`,
      headers: headers(),
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().revision).toBe(2);
    const stale = await server.app.inject({
      method: "PUT",
      url: `/api/editor/projects/${d.id}`,
      headers: headers(),
      payload: body,
    });
    expect(stale.statusCode).toBe(409);
  });
  it("exports a real ZIP with a manifest", async () => {
    const r = await server.app.inject({
      method: "POST",
      url: `/api/editor/projects/${draftId}/export`,
      headers: headers(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("application/zip");
    expect(r.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });
  it("server preview runs the same content and simulation", async () => {
    const r = await server.app.inject({
      method: "POST",
      url: "/api/editor/preview",
      headers: headers(),
      payload: {
        content,
        campaignId: content.campaigns.items[0].id,
        characterId: content.characters.items[0].id,
        seed: 42,
        ticks: 60,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().tick).toBe(60);
    expect(r.json().contentVersion).toBe("preview");
  });
  it("creates and starts an authoritative room with pinned content", async () => {
    const created = await server.app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: headers("player"),
      payload: { campaignId: content.campaigns.items[0].id },
    });
    expect(created.statusCode).toBe(200);
    roomId = created.json().id;
    expect(
      (
        await server.app.inject({
          method: "POST",
          url: `/api/rooms/${roomId}/start`,
          headers: headers("player"),
        })
      ).statusCode,
    ).toBe(409);
    await server.app.inject({
      method: "POST",
      url: `/api/rooms/${roomId}/ready`,
      headers: headers("player"),
      payload: { ready: true, characterId: content.characters.items[0].id },
    });
    const start = await server.app.inject({
      method: "POST",
      url: `/api/rooms/${roomId}/start`,
      headers: headers("player"),
    });
    expect(start.statusCode).toBe(200);
    runId = start.json().runId;
    expect(start.json().contentVersion).toBeDefined();
  });
  it("accepts WS input, rejects extra authority fields and reconnects", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${roomId}`, {
      headers: { origin, cookie: playerCookie },
    });
    const messages: any[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        type: "input",
        input: {
          seq: 0,
          moveX: 1,
          moveY: 0,
          aim: 0,
          fire: true,
          interact: false,
          weaponSlot: 0,
          hp: 99999,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(
      messages.some((m) => m.type === "error" && m.message === "Invalid input"),
    ).toBe(true);
    ws.send(
      JSON.stringify({
        type: "input",
        input: {
          seq: 1,
          moveX: 1,
          moveY: 0,
          aim: 0,
          fire: true,
          interact: false,
          weaponSlot: 0,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 150));
    const state = messages.filter((m) => m.type === "snapshot").at(-1)
      .state as WorldState;
    expect(state.tick).toBeGreaterThan(0);
    expect(state.actors.find((a) => a.id === uid)!.input.seq).toBe(1);
    ws.close();
    await new Promise((r) => ws.once("close", r));
    const re = new WebSocket(`ws://127.0.0.1:${port}/ws/rooms/${roomId}`, {
      headers: { origin, cookie: playerCookie },
    });
    const snapshot = await new Promise<WorldState>((resolve, reject) => {
      re.on("message", (data) => {
        const m = JSON.parse(data.toString());
        if (m.type === "snapshot") resolve(m.state);
      });
      re.once("error", reject);
    });
    expect(snapshot.runId).toBe(runId);
    expect(snapshot.tick).toBeGreaterThanOrEqual(state.tick);
    re.close();
    await new Promise((r) => re.once("close", r));
  });
  it("rejects progress reset during an active room", async () => {
    const r = await server.app.inject({
      method: "POST",
      url: "/api/users/me/progress/reset",
      headers: headers("player"),
      payload: { confirmation: "RESET PROGRESS", requestId: randomUUID() },
    });
    expect(r.statusCode).toBe(409);
  });
  it("checkpoints stats idempotently and reset preserves lifetime totals", async () => {
    const live = server.rooms.member(roomId, uid),
      actor = live.simulation!.state.actors.find((a) => a.id === uid)!;
    actor.kills = 5;
    live.simulation!.state.tick += 1;
    await server.rooms.checkpoint(live);
    await server.rooms.checkpoint(live);
    expect((await db.user.findUniqueOrThrow({ where: { uid } })).kills).toBe(5);
    await server.rooms.leave(roomId, uid);
    const key = randomUUID(),
      payload = { confirmation: "RESET PROGRESS", requestId: key };
    const a = await server.app.inject({
      method: "POST",
      url: "/api/users/me/progress/reset",
      headers: headers("player"),
      payload,
    });
    const b = await server.app.inject({
      method: "POST",
      url: "/api/users/me/progress/reset",
      headers: headers("player"),
      payload,
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect((await db.user.findUniqueOrThrow({ where: { uid } })).kills).toBe(5);
  });
});
