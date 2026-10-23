import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Ajv from "ajv";
import type { WebSocket } from "ws";
import { Simulation } from "../../../packages/simulation/src/simulation";
import type {
  WorldState,
  ProgressFacts,
} from "../../../packages/simulation/src/types";
import {
  evaluateCondition,
  mergeFacts,
} from "../../../packages/simulation/src/rewards";
import {
  ClientMessageSchema,
  type RoomView,
  type RoomMember,
} from "../../../packages/multiplayer-protocol/src/index";
import { TICK_RATE } from "../../../packages/shared-types/src/index";
import { ContentService, json } from "./content-service";
import { db } from "./db";
import { HttpError } from "./auth";
const validate = new Ajv({ strict: false }).compile(ClientMessageSchema);
type LiveRoom = {
  view: RoomView;
  simulation?: Simulation;
  sockets: Map<string, WebSocket>;
  saving: Promise<unknown>;
  error?: string;
  lastSave: number;
};
export class RoomManager {
  private rooms = new Map<string, LiveRoom>();
  private timer?: ReturnType<typeof setInterval>;
  private locks = new Map<string, Promise<unknown>>();
  metrics = { tickMs: 0, maxTickMs: 0, rooms: 0, entities: 0 };
  constructor(
    readonly content: ContentService,
    private report: (error: unknown) => void = console.error,
  ) {}
  async init(restore = true) {
    for (const row of restore ? await db.room.findMany({
      where: { status: { in: ["lobby", "running", "victory", "defeat"] } },
    }) : []) {
      const view: RoomView = {
        ...row,
        status: row.status as RoomView["status"],
        members: (row.members as unknown as RoomMember[]).map((m) => ({
          ...m,
          connected: false,
        })),
        runId: row.runId,
      };
      const live: LiveRoom = {
        view,
        sockets: new Map(),
        saving: Promise.resolve(),
        lastSave: 0,
      };
      if (row.runId) {
        const run = await db.run.findUnique({ where: { id: row.runId } });
        if (run)
          live.simulation = new Simulation(
            await this.content.registry(row.contentVersion),
            run.state as unknown as WorldState,
          );
      }
      this.rooms.set(row.id, live);
    }
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    for (const live of this.rooms.values()) {
      if (live.simulation) await this.checkpoint(live);
      for (const ws of live.sockets.values()) ws.close(1001, "Server shutdown");
    }
    await Promise.all([...this.rooms.values()].map((x) => x.saving));
  }
  private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(work);
    this.locks.set(id, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }
  get(id: string) {
    const live = this.rooms.get(id);
    if (!live) throw new HttpError(404, "Room not found");
    return live;
  }
  member(id: string, uid: string) {
    const live = this.get(id);
    if (!live.view.members.some((m) => m.uid === uid))
      throw new HttpError(403, "Not a room member");
    return live;
  }
  async create(uid: string, campaignId: string) {
    return this.exclusive(`user:${uid}`,()=>this.createForUser(uid,campaignId));
  }
  private async createForUser(uid:string,campaignId:string){
    if (
      [...this.rooms.values()].some(
        (r) =>
          r.view.members.some((m) => m.uid === uid) &&
          ["lobby", "running"].includes(r.view.status),
      )
    )
      throw new HttpError(409, "Already in an active room");
    const version = await this.content.active(),
      registry = await this.content.registry(version);
    registry.get("campaigns", campaignId);
    const user = await db.user.findUniqueOrThrow({ where: { uid } });
    const hero = registry.all("characters").find((c) => !c.unlockRuleId)!;
    const view: RoomView = {
      id: randomBytes(9).toString("base64url"),
      ownerId: uid,
      members: [
        {
          uid,
          name: user.name,
          characterId: hero.id,
          ready: false,
          connected: false,
        },
      ],
      status: "lobby",
      campaignId,
      contentVersion: version,
      runId: null,
    };
    const live = {
      view,
      sockets: new Map(),
      saving: Promise.resolve(),
      lastSave: 0,
    };
    await db.room.create({ data: { ...view, members: json(view.members) } });
    this.rooms.set(view.id, live);
    return view;
  }
  async join(id: string, uid: string) {
    return this.exclusive(`user:${uid}`,()=>this.exclusive(id, async () => {
      const live = this.get(id);
      if (live.view.members.some((m) => m.uid === uid)) return live.view;
      if (live.view.status !== "lobby" || live.view.members.length >= 4)
        throw new HttpError(409, "Room is full or already started");
      if (
        [...this.rooms.values()].some(
          (r) =>
            r.view.id !== id &&
            r.view.members.some((m) => m.uid === uid) &&
            ["lobby", "running"].includes(r.view.status),
        )
      )
        throw new HttpError(409, "Already in another room");
      const user = await db.user.findUniqueOrThrow({ where: { uid } }),
        registry = await this.content.registry(live.view.contentVersion);
      live.view.members.push({
        uid,
        name: user.name,
        characterId: registry.all("characters").find((c) => !c.unlockRuleId)!
          .id,
        ready: false,
        connected: false,
      });
      await this.saveRoom(live);
      return live.view;
    }));
  }
  async ready(id: string, uid: string, ready: boolean, characterId: string) {
    return this.exclusive(id, async () => {
      const live = this.member(id, uid);
      if (live.view.status !== "lobby")
        throw new HttpError(409, "Run already started");
      const registry = await this.content.registry(live.view.contentVersion),
        character = registry.get("characters", characterId);
      if (
        character.unlockRuleId &&
        !(await db.unlock.findUnique({
          where: { uid_characterId: { uid, characterId } },
        }))
      )
        throw new HttpError(403, "Character locked");
      const member = live.view.members.find((m) => m.uid === uid)!;
      member.ready = ready;
      member.characterId = characterId;
      await this.saveRoom(live);
      return live.view;
    });
  }
  async start(id: string, uid: string) {
    return this.exclusive(id, async () => {
      const live = this.member(id, uid);
      if (live.view.ownerId !== uid)
        throw new HttpError(403, "Only owner can start");
      if (
        live.view.status !== "lobby" ||
        !live.view.members.every((m) => m.ready)
      )
        throw new HttpError(409, "All players must be ready");
      const runId = randomUUID(),
        registry = await this.content.registry(live.view.contentVersion);
      const seed = randomBytes(4).readUInt32LE();
      const sim = new Simulation(registry, {
        runId,
        seed,
        campaignId: live.view.campaignId,
        players: live.view.members.map((m) => ({
          id: m.uid,
          characterId: m.characterId,
        })),
      });
      await db.$transaction(async (tx) => {
        await tx.run.create({
          data: {
            id: runId,
            contentVersion: registry.version,
            state: json(sim.snapshot()),
            status: "running",
            participants: {
              create: live.view.members.map((m) => ({ uid: m.uid })),
            },
          },
        });
        await tx.room.update({
          where: { id },
          data: { status: "running", runId },
        });
      });
      live.simulation = sim;
      live.view.status = "running";
      live.view.runId = runId;
      this.broadcast(live, { type: "room", room: live.view });
      return live.view;
    });
  }
  async transfer(id: string, uid: string, target: string) {
    const live = this.member(id, uid);
    if (
      live.view.ownerId !== uid ||
      !live.view.members.some((m) => m.uid === target)
    )
      throw new HttpError(403, "Invalid owner transfer");
    live.view.ownerId = target;
    await this.saveRoom(live);
    return live.view;
  }
  async leave(id: string, uid: string, target = uid) {
    return this.exclusive(id, async () => {
      const live = this.member(id, uid);
      if (
        target !== uid &&
        (live.view.ownerId !== uid || live.view.status !== "lobby")
      )
        throw new HttpError(403, "Only lobby owner can remove another player");
      if(live.simulation){await this.checkpoint(live);const actor=live.simulation.state.actors.find(a=>a.id===target);if(actor){actor.hp=0;actor.departed=true;actor.state='death';actor.stateTick=live.simulation.state.tick;}await db.participant.update({where:{runId_uid:{runId:live.simulation.state.runId,uid:target}},data:{canResume:false}});}
      const socket = live.sockets.get(target);
      live.sockets.delete(target);
      socket?.close(1000, "Left room");
      live.view.members = live.view.members.filter((m) => m.uid !== target);
      if (!live.view.members.length) {
        live.view.status = "closed";
        if (live.simulation) {
          live.simulation.state.status = "defeat";
          await this.checkpoint(live);
        }
      } else if (live.view.ownerId === target)
        live.view.ownerId = live.view.members[0].uid;
      await this.saveRoom(live);
      if (live.view.status === "closed") this.rooms.delete(id);
      return live.view;
    });
  }
  activeFor(uid: string) {
    return [...this.rooms.values()]
      .filter(
        (r) =>
          r.view.members.some((m) => m.uid === uid) &&
          ["lobby", "running"].includes(r.view.status),
      )
      .map((r) => r.view);
  }
  currentFor(uid: string) {
    const active = this.activeFor(uid);
    if (active.length) return active;
    // Keep an unacknowledged result available after refresh. Explicit leave closes it.
    return [...this.rooms.values()].reverse().filter(r =>
      r.view.members.some(m => m.uid === uid) && ["victory", "defeat"].includes(r.view.status)
    ).slice(0, 1).map(r => r.view);
  }
  attach(id: string, uid: string, socket: WebSocket, sessionHash: string) {
    const live = this.member(id, uid);
    live.sockets.get(uid)?.close(1000, "Connection replaced");
    live.sockets.set(uid, socket);
    const member = live.view.members.find((m) => m.uid === uid)!;
    member.connected = true;
    let window = Date.now(),
      count = 0;
    socket.send(JSON.stringify({ type: "room", room: live.view }));
    if (live.simulation)
      socket.send(
        JSON.stringify({ type: "snapshot", state: live.simulation.snapshot() }),
      );
    this.broadcast(live, { type: "room", room: live.view });
    socket.on("message", (bytes) => {
      if (Date.now() - window > 1000) {
        window = Date.now();
        count = 0;
      }
      const length = Array.isArray(bytes)
        ? bytes.reduce((n, b) => n + b.byteLength, 0)
        : bytes.byteLength;
      if (++count > 90 || length > 4096) {
        socket.close(1008, "Input rate exceeded");
        return;
      }
      try {
        const message = JSON.parse(bytes.toString());
        if (!validate(message)) {
          socket.send(
            JSON.stringify({ type: "error", message: "Invalid input" }),
          );
          return;
        }
        live.simulation?.input(uid, message.input);
      } catch {
        socket.close(1008, "Malformed message");
      }
    });
    const authTimer = setInterval(() => {
      void db.session
        .findUnique({ where: { hash: sessionHash } })
        .then((s) => {
          if (!s || s.expiresAt.getTime() < Date.now())
            socket.close(1008, "Session expired");
        })
        .catch(this.report);
    }, 10000);
    socket.on("close", () => {
      clearInterval(authTimer);
      if (live.sockets.get(uid) !== socket) return;
      live.sockets.delete(uid);
      member.connected = false;
      const next = live.view.members.find((m) => m.connected);
      if (live.view.ownerId === uid && next) live.view.ownerId = next.uid;
      void this.saveRoom(live).catch(this.report);
    });
  }
  private broadcast(live: LiveRoom, message: unknown) {
    const data = JSON.stringify(message);
    for (const socket of live.sockets.values())
      if (socket.readyState === 1) {
        if (socket.bufferedAmount > 2 * 1024 * 1024) {
          socket.close(1013, "Slow connection");
          continue;
        }
        socket.send(data);
      }
  }
  private tick() {
    const started = performance.now();
    let entities = 0;
    for (const live of this.rooms.values()) {
      if (
        !live.simulation ||
        live.view.status !== "running" ||
        live.error ||
        !live.sockets.size
      )
        continue;
      try {
        live.simulation.step();
        if (live.simulation.state.events.length)
          this.broadcast(live, {
            type: "events",
            events: live.simulation.state.events,
          });
        entities +=
          live.simulation.state.actors.length +
          live.simulation.state.projectiles.length;
        if (
          live.simulation.state.tick % 2 === 0 ||
          live.simulation.state.status !== "running"
        )
          this.broadcast(live, {
            type: "snapshot",
            state: live.simulation.snapshot(),
          });
        if (
          live.simulation.state.tick - live.lastSave >= 150 ||
          live.simulation.state.status !== "running"
        ) {
          live.lastSave = live.simulation.state.tick;
          void this.checkpoint(live).catch((e) => {
            live.error = "Save failed";
            this.broadcast(live, { type: "error", message: live.error });
            this.report(e);
          });
        }
        if (live.simulation.state.status !== "running") {
          live.view.status = live.simulation.state.status;
          void this.saveRoom(live).catch(this.report);
        }
      } catch (e) {
        live.error = "Simulation stopped";
        this.broadcast(live, { type: "error", message: live.error });
        this.report(e);
      }
    }
    this.metrics = {
      tickMs: performance.now() - started,
      maxTickMs: Math.max(this.metrics.maxTickMs, performance.now() - started),
      rooms: this.rooms.size,
      entities,
    };
  }
  private async saveRoom(live: LiveRoom) {
    await db.room.update({
      where: { id: live.view.id },
      data: {
        ownerId: live.view.ownerId,
        members: json(live.view.members),
        status: live.view.status,
        runId: live.view.runId,
      },
    });
    this.broadcast(live, { type: "room", room: live.view });
  }
  async checkpoint(live: LiveRoom) {
    const state = live.simulation?.snapshot();
    if (!state) return;
    const registry = live.simulation!.registry;
    const task = live.saving.then(() =>
      db.$transaction(
        async (tx) => {
          const run = await tx.run.findUniqueOrThrow({
            where: { id: state.runId },
          });
          if ((run.state as unknown as WorldState).tick > state.tick) return;
          await tx.run.update({
            where: { id: state.runId },
            data: {
              state: json(state),
              revision: { increment: 1 },
              status: state.status,
              endedAt: state.status === "running" ? null : new Date(),
            },
          });
          for (const actor of state.actors.filter((a) => a.kind === "player")) {
            const part = await tx.participant.findUniqueOrThrow({
                where: { runId_uid: { runId: state.runId, uid: actor.id } },
              }),
              user = await tx.user.findUniqueOrThrow({
                where: { uid: actor.id },
              });
            if(!part.canResume||actor.departed)continue;
            const facts = mergeFacts(
              user.facts as unknown as ProgressFacts,
              state.progress,
            );
            const newDeath = actor.hp <= 0 && !part.countedDeath;
            await tx.user.update({
              where: { uid: actor.id },
              data: {
                kills: {
                  increment: Math.max(0, actor.kills - part.countedKills),
                },
                deaths: { increment: newDeath ? 1 : 0 },
                maxDepth: Math.max(user.maxDepth, state.depth),
                facts: json(facts),
              },
            });
            await tx.participant.update({
              where: { runId_uid: { runId: state.runId, uid: actor.id } },
              data: {
                countedKills: actor.kills,
                countedDeath: part.countedDeath || actor.hp <= 0,
              },
            });
            const coop =
              state.actors.filter((a) => a.kind === "player").length > 1;
            for (const rule of registry.all("unlocks")) {
              if (rule.mode !== "any" && rule.mode !== (coop ? "coop" : "solo"))
                continue;
              if (rule.participantRequirement === "alive" && actor.hp <= 0)
                continue;
              if (
                !evaluateCondition(
                  rule.conditions,
                  rule.progressScope === "account" ? facts : state.progress,
                )
              )
                continue;
              await tx.unlock.upsert({
                where: {
                  uid_characterId: {
                    uid: actor.id,
                    characterId: rule.rewardCharacterId,
                  },
                },
                create: {
                  uid: actor.id,
                  characterId: rule.rewardCharacterId,
                  ruleId: rule.id,
                  contentVersion: state.contentVersion,
                  sourceRunId: state.runId,
                },
                update: {},
              });
            }
            for (const level of state.progress.levels)
              await tx.progressEvent.upsert({
                where: { id: `${state.runId}:${actor.id}:level:${level}` },
                create: {
                  id: `${state.runId}:${actor.id}:level:${level}`,
                  uid: actor.id,
                  runId: state.runId,
                  type: "level.completed",
                  payload: json({ levelId: level }),
                },
                update: {},
              });
          }
        },
        { timeout: 20000 },
      ),
    );
    live.saving = task;
    return task;
  }
}
