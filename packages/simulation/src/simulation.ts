import validators from "../../content-schemas/src/generated/validators.cjs";
import { ContentRegistry } from "../../content-loader/src/registry";
import {
  Rng,
  clamp,
  distanceSq,
  quantize,
  segmentCircle,
  angleDelta,
  circleCollider,
  segmentCollider,
} from "../../game-core/src/math";
import {
  generateLevel,
  circleBlocked,
  pathTo,
} from "../../procedural-generation/src/index";
import {
  TICK_RATE,
  ENGINE_VERSION,
  type GameEvent,
  type EventName,
  type InputCommand,
  type Vec2,
} from "../../shared-types/src/index";
import {
  conditionMatches,
  executeGraph,
  type EffectAction,
} from "../../effect-engine/src/index";
import { extensions } from "../../mutation-extensions/src/generated/index";
import type { MutationContext, EntityView } from "../../mutation-sdk/src/index";
import { resolveDrops, evaluateCondition } from "./rewards";
import {
  neutralInput,
  type Actor,
  type WorldState,
  type Projectile,
} from "./types";
const extensionValidators = new Map(
  extensions.map((x) => [x.meta.id, validators[x.meta.id]]),
);
export class Simulation {
  state: WorldState;
  private combat: Rng;
  private loot: Rng;
  private queuedDamage: {
    ownerId: string;
    targetId: string;
    amount: number;
    damageType: string;
    origin: GameEvent["origin"];
  }[] = [];
  constructor(
    readonly registry: ContentRegistry,
    args:
      | {
          runId: string;
          seed: number;
          campaignId: string;
          players: { id: string; characterId: string }[];
        }
      | WorldState,
  ) {
    if ("schemaVersion" in args) {
      if (
        args.contentVersion !== registry.version ||
        args.engineVersion !== ENGINE_VERSION
      )
        throw new Error("Incompatible saved simulation");
      this.state = structuredClone(args);
      this.combat = new Rng(args.random.combat);
      this.loot = new Rng(args.random.loot);
      return;
    }
    const campaign = registry.get("campaigns", args.campaignId);
    const node = this.resolveNode(
      campaign.startNodeId,
      args.seed,
      args.campaignId,
    );
    if (!node.levelId) throw new Error("Campaign must lead to a level");
    this.combat = new Rng(args.seed ^ 0x12345678);
    this.loot = new Rng(args.seed ^ 0x76543210);
    this.state = {
      schemaVersion: "1.0.0",
      engineVersion: ENGINE_VERSION,
      contentVersion: registry.version,
      runId: args.runId,
      seed: args.seed,
      tick: 0,
      sequence: 0,
      entitySequence: 0,
      random: { combat: this.combat.state, loot: this.loot.state },
      campaignId: args.campaignId,
      nodeId: node.nodeId,
      levelId: node.levelId,
      depth: 1,
      status: "running",
      map: generateLevel(registry, node.levelId, args.seed, { depth: 1, difficultyScale: node.difficultyScale }),
      actors: [],
      projectiles: [],
      props: [],
      chests: [],
      pickups: [],
      beams: [],
      events: [],
      progress: { levels: [], biomes: [], bosses: [], maxDepth: 1 },
      completed: false,
      repeatCount: 0,
      delayed: [],
    };
    args.players.forEach((p, i) => {
      const actor = this.createActor(
        "player",
        p.characterId,
        p.id,
        this.state.map.spawn,
      );
      actor.x += i * 4;
      this.state.actors.push(actor);
    });
    this.populate();
    this.emit("run.started", "server", { campaignId: args.campaignId });
    this.emit("level.started", "server", {
      levelId: node.levelId,
      biomeId: this.state.map.biomeId,
    });
  }
  private resolveNode(id: string, seed: number, campaignId?: string) {
    const campaign = this.registry.get(
      "campaigns",
      campaignId ??
        this.state?.campaignId ??
        this.registry.all("campaigns")[0].id,
    );
    const rng = new Rng(seed);
    for (let i = 0; i < 256; i++) {
      const node = campaign.nodes.find((n) => n.nodeId === id);
      if (!node) throw new Error("Invalid campaign node");
      if (node.kind !== "milestone") return node;
      const edges = campaign.edges.filter((e) => e.fromNodeId === id);
      if (!edges.length) throw new Error("Dead milestone");
      id = rng.weighted(edges, (e) => e.weight).toNodeId;
    }
    throw new Error("Campaign traversal limit");
  }
  private createActor(
    kind: Actor["kind"],
    definitionId: string,
    id: string,
    pos: Vec2,
  ): Actor {
    const def = this.registry.get(
      kind === "player" ? "characters" : kind === "boss" ? "bosses" : "enemies",
      definitionId,
    );
    const stats = def.stats;
    const weapons =
      kind === "player"
        ? this.registry.get("characters", definitionId).startingWeaponIds
        : [];
    const radius =
      def.collision.shape === "circle"
        ? def.collision.radius
        : Math.max(def.collision.width, def.collision.height) / 2;
    return {
      id,
      definitionId,
      kind,
      team: kind === "player" ? "players" : "enemies",
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      radius,
      hp: stats.maxHealth,
      maxHp: stats.maxHealth,
      speed: stats.moveSpeed,
      armor: stats.armor,
      damageMultiplier: stats.damageMultiplier,
      fireRateMultiplier: stats.fireRateMultiplier,
      critChance: stats.critChance,
      pickupRadius: stats.pickupRadius,
      aim: 0,
      state: "idle",
      stateTick: 0,
      weaponIds: [...weapons],
      weaponSlot: 0,
      ammo: Object.fromEntries(
        weapons.map((id) => [
          id,
          this.registry.get("weapons", id).magazineSize,
        ]),
      ),
      reserve: 150,
      readyTick: 0,
      reloadTick: 0,
      attackTick: 0,
      attackPatternId: "",
      phaseId: "",
      xp: 0,
      level: 1,
      kills: 0,
      mutations: [],
      mutationChoices: [],
      statuses: [],
      input: neutralInput(),
      lastInputTick: 0,
      effectState: {},
      path: [],
    };
  }
  private populate() {
    for (const p of this.state.map.placements) {
      const id = this.id(p.kind);
      if (p.kind === "enemy" || p.kind === "boss")
        this.state.actors.push(
          this.createActor(p.kind, p.definitionId, id, p.position),
        );
      else if (p.kind === "prop")
        this.state.props.push({
          id,
          definitionId: p.definitionId,
          ...p.position,
          hp: this.registry.get("props", p.definitionId).maxHealth,
          destroyed: false,
        });
      else
        this.state.chests.push({
          id,
          definitionId: p.definitionId,
          ...p.position,
          state: "closed",
          openTick: 0,
          openerId: "",
          claimedBy: [],
        });
    }
  }
  private id(prefix: string) {
    return `${prefix}-${++this.state.entitySequence}`;
  }
  private emit(
    type: EventName,
    actorId: string,
    payload: GameEvent["payload"] = {},
    targetId?: string,
    origin: GameEvent["origin"] = {
      kind: "environment",
      id: "world",
      depth: 0,
    },
    position?: Vec2,
  ) {
    const actor = this.state.actors.find((a) => a.id === actorId);
    const event: GameEvent = {
      eventId: `${this.state.runId}:${this.state.tick}:${++this.state.sequence}`,
      tick: this.state.tick,
      type,
      actorId,
      targetId,
      payload,
      origin,
      position: position ?? { x: actor?.x ?? 0, y: actor?.y ?? 0 },
    };
    if (this.state.events.length < 1024) this.state.events.push(event);
    return event;
  }
  input(playerId: string, input: InputCommand) {
    const p = this.state.actors.find(
      (a) => a.id === playerId && a.kind === "player",
    );
    if (!p || input.seq <= p.input.seq) return false;
    p.input = {
      ...input,
      moveX: clamp(input.moveX, -1, 1),
      moveY: clamp(input.moveY, -1, 1),
      weaponSlot: clamp(
        input.weaponSlot,
        0,
        Math.max(0, p.weaponIds.length - 1),
      ),
    };
    p.lastInputTick = this.state.tick;
    return true;
  }
  snapshot() {
    this.state.random = { combat: this.combat.state, loot: this.loot.state };
    return structuredClone(this.state);
  }
  step() {
    if (this.state.status !== "running") return;
    this.state.events = [];
    this.state.tick++;
    this.state.sequence = 0;
    for (const actor of this.state.actors) {
      if (actor.hp <= 0) continue;
      this.updateStatuses(actor);
      if (actor.hp <= 0) continue;
      if (actor.kind === "player") this.updatePlayer(actor);
      else this.updateEnemy(actor);
    }
    for (const shot of this.state.projectiles) this.updateProjectile(shot);
    this.state.projectiles = this.state.projectiles.filter(
      (p) => p.expires > this.state.tick,
    );
    this.state.beams = this.state.beams.filter(
      (b) => b.expires > this.state.tick,
    );
    this.updateChests();
    this.updatePickups();
    this.processEffects();
    this.checkLevel();
    if (
      this.state.actors
        .filter((a) => a.kind === "player")
        .every((a) => a.hp <= 0)
    )
      this.state.status = "defeat";
    this.state.random = { combat: this.combat.state, loot: this.loot.state };
  }
  private updatePlayer(p: Actor) {
    const input =
      this.state.tick - p.lastInputTick > 15
        ? { ...neutralInput(), aim: p.aim, weaponSlot: p.weaponSlot }
        : p.input;
    p.aim = input.aim;
    p.weaponSlot = input.weaponSlot;
    if (input.mutationId && p.mutationChoices.includes(input.mutationId)) {
      p.mutations.push(input.mutationId);
      p.mutationChoices = [];
      const mutation = this.registry.get("mutations", input.mutationId);
      for (const effectId of mutation.effectIds) {
        const effect = this.registry.get("effects", effectId);
        for (const action of effect.actions)
          if (action.type === "modify_stat")
            this.action(
              p,
              action,
              this.emit("mutation.activated", p.id, {
                mutationId: mutation.id,
              }),
            );
      }
    }
    const magnitude = Math.hypot(input.moveX, input.moveY) || 1;
    this.move(
      p,
      input.moveX / Math.max(1, magnitude),
      input.moveY / Math.max(1, magnitude),
    );
    const weaponId = p.weaponIds[p.weaponSlot];
    if (input.fire && weaponId) this.fire(p, weaponId, p.aim);
    if (input.interact) {
      for (const chest of this.state.chests) {
        const def = this.registry.get("chests", chest.definitionId);
        if (
          chest.state === "closed" &&
          def.interaction.mode === "interact" &&
          distanceSq(p, chest) <= def.interaction.radius ** 2
        )
          this.openChest(chest, p);
      }
      if (this.state.completed && distanceSq(p, this.state.map.exit) < 48 ** 2)
        this.advance(input.exitNodeId);
    }
  }
  private updateStatuses(p: Actor) {
    for (const active of p.statuses) {
      const def = this.registry.get("statuses", active.id);
      if (this.state.tick >= active.nextTick) {
        active.nextTick += def.tickInterval;
        this.damage(active.ownerId, p.id, def.damagePerTick, def.damageTypeId, {
          kind: "mutation",
          id: def.id,
          depth: 1,
        });
      }
    }
    p.statuses = p.statuses.filter((s) => s.until > this.state.tick);
  }
  private move(p: Actor, dx: number, dy: number) {
    let speed = p.speed;
    for (const s of p.statuses) {
      const def = this.registry.get("statuses", s.id);
      speed *= def.stun ? 0 : def.speedMultiplier;
    }
    const old = {x:p.x,y:p.y},magnitude=Math.max(1,Math.hypot(dx,dy));
    dx/=magnitude;dy/=magnitude;
    const steps=Math.max(1,Math.ceil(speed/TICK_RATE/4));
    for(let i=0;i<steps;i++){const x=quantize(p.x+dx*speed/TICK_RATE/steps),y=quantize(p.y+dy*speed/TICK_RATE/steps);if(!this.blocked({x,y:p.y},p.radius))p.x=x;if(!this.blocked({x:p.x,y},p.radius))p.y=y;}
    p.vx = (p.x - old.x) * TICK_RATE;
    p.vy = (p.y - old.y) * TICK_RATE;
    if (p.state === "hurt" && this.state.tick - p.stateTick < 5) return;
    if (p.attackTick > this.state.tick) {
      p.state = "windup";
      return;
    }
    const state = p.vx || p.vy ? "run" : "idle";
    if (p.state !== state) {
      p.state = state;
      p.stateTick = this.state.tick;
    }
  }
  private blocked(position: Vec2, r: number, projectile = false) {
    if (circleBlocked(this.state.map, position, r, projectile)) return true;
    return this.state.props.some((p) => {
      if (p.destroyed) return false;
      const def = this.registry.get("props", p.definitionId);
      if (!(projectile ? def.blocksProjectiles : def.blocksMovement))
        return false;
      return circleCollider(position,r,p,def.collision);
    })||this.state.chests.some(chest=>chest.state!=='opened'&&circleCollider(position,r,chest,this.registry.get('chests',chest.definitionId).collision));
  }
  private updateEnemy(p: Actor) {
    const def = this.registry.get(
      p.kind === "boss" ? "bosses" : "enemies",
      p.definitionId,
    );
    let behaviorId: string, patterns: string[];
    if (p.kind === "boss") {
      const boss = this.registry.get("bosses", p.definitionId);
      const phase =
        [...boss.phases]
          .sort((a, b) => b.minHealthRatio - a.minHealthRatio)
          .find((f) => p.hp / p.maxHp > f.minHealthRatio) ??
        boss.phases.at(-1)!;
      if (phase.id !== p.phaseId) {
        p.phaseId = phase.id;
        this.emit("boss.phase_changed", p.id, {
          bossId: p.definitionId,
          phaseId: phase.id,
        });
      }
      behaviorId = phase.behaviorId;
      patterns = phase.attackPatternIds;
    } else {
      const enemy = this.registry.get("enemies", p.definitionId);
      behaviorId = enemy.behaviorId;
      patterns = enemy.attackPatternIds;
    }
    const behavior = this.registry.get("behaviors", behaviorId),
      target = this.state.actors
        .filter((a) => a.team !== p.team && a.hp > 0)
        .sort(
          (a, b) =>
            distanceSq(a, p) - distanceSq(b, p) || a.id.localeCompare(b.id),
        )[0];
    if (!target) return;
    const d = Math.sqrt(distanceSq(p, target));
    if (d > behavior.detectionRange) return;
    p.aim = Math.atan2(target.y - p.y, target.x - p.x);
    const stunned = p.statuses.some(
      (s) => this.registry.get("statuses", s.id).stun,
    );
    if (stunned && p.attackTick) {
      p.attackTick = 0;
      this.emit(
        p.kind === "boss" ? "boss.attack_cancelled" : "enemy.attack_cancelled",
        p.id,
        { [p.kind === "boss" ? "bossId" : "enemyId"]: p.definitionId },
      );
    }
    if (!stunned && p.attackTick && this.state.tick >= p.attackTick) {
      const pattern = this.registry.get("attackPatterns", p.attackPatternId);
      p.readyTick = 0;
      for (let shot = 0; shot < pattern.shots; shot++) {
        const offset =
          pattern.aim === "radial"
            ? (shot * Math.PI * 2) / pattern.shots
            : ((shot - (pattern.shots - 1) / 2) * pattern.spreadDeg * Math.PI) /
              180;
        p.readyTick = 0;
        this.fire(
          p,
          pattern.weaponId,
          (pattern.aim === "radial" ? 0 : p.aim) + offset,
          true,
        );
      }
      if (pattern.summonEnemyId)
        for (
          let j = 0;
          j < pattern.summonCount && this.state.actors.length < 500;
          j++
        ) {
          const pos = { x: p.x + Math.cos(j) * 40, y: p.y + Math.sin(j) * 40 };
          if (!this.blocked(pos, 12))
            this.state.actors.push(
              this.createActor(
                "enemy",
                pattern.summonEnemyId,
                this.id("summon"),
                pos,
              ),
            );
        }
      p.attackTick = 0;
      p.readyTick = this.state.tick + pattern.recoveryTicks;
      this.emit(
        p.kind === "boss" ? "boss.attack_executed" : "enemy.attack_executed",
        p.id,
        { [p.kind === "boss" ? "bossId" : "enemyId"]: p.definitionId },
      );
    }
    if (
      !stunned &&
      !p.attackTick &&
      this.state.tick >= p.readyTick &&
      d <= Math.max(behavior.preferredRange + 64, 100)
    ) {
      const pattern = this.registry.get(
        "attackPatterns",
        patterns[this.combat.int(0, patterns.length - 1)],
      );
      p.attackPatternId = pattern.id;
      p.attackTick = this.state.tick + Math.max(1, pattern.windupTicks);
      p.state = "windup";
      p.stateTick = this.state.tick;
      this.emit(
        p.kind === "boss"
          ? "boss.attack_windup_started"
          : "enemy.attack_windup_started",
        p.id,
        {
          [p.kind === "boss" ? "bossId" : "enemyId"]: p.definitionId,
          executeTick: p.attackTick,
        },
      );
    }
    let dx = 0,
      dy = 0;
    if (!p.attackTick && behavior.mode !== "guard") {
      let direction =
        behavior.mode === "flee"
          ? -1
          : d < behavior.preferredRange * 0.7 && behavior.mode === "ranged"
            ? -1
            : d > behavior.preferredRange
              ? 1
              : 0;
      let aim = p.aim;
      if (direction > 0 && behavior.navigation) {
        if (this.state.tick % 10 === 0 || !p.path.length)
          p.path = pathTo(this.state.map, p, target);
        while (p.path.length && distanceSq(p, p.path[0]) < 8 ** 2)
          p.path.shift();
        if (p.path[0]) aim = Math.atan2(p.path[0].y - p.y, p.path[0].x - p.x);
      }
      dx =
        Math.cos(aim) * direction +
        Math.cos(aim + Math.PI / 2) * behavior.strafe;
      dy =
        Math.sin(aim) * direction +
        Math.sin(aim + Math.PI / 2) * behavior.strafe;
    }
    this.move(p, dx, dy);
    if (d < p.radius + target.radius + 2 && this.state.tick % 30 === 0)
      this.damage(p.id, target.id, def.contactDamage, "physical", {
        kind: "environment",
        id: p.definitionId,
        depth: 0,
      });
  }
  private fire(p: Actor, weaponId: string, aim: number, unlimited = false) {
    if (
      this.state.tick < p.readyTick ||
      p.hp <= 0 ||
      p.statuses.some((s) => this.registry.get("statuses", s.id).stun)
    )
      return;
    const w = this.registry.get("weapons", weaponId);
    if (!unlimited) {
      if (p.reloadTick) {
        if (this.state.tick < p.reloadTick) return;
        const amount = Math.min(
          w.magazineSize - (p.ammo[weaponId] ?? 0),
          p.reserve,
        );
        p.ammo[weaponId] = (p.ammo[weaponId] ?? 0) + amount;
        p.reserve -= amount;
        p.reloadTick = 0;
        this.emit("weapon.reloaded", p.id, { weaponId });
      }
      if ((p.ammo[weaponId] ?? 0) < w.ammoPerShot) {
        if (p.reserve > 0) p.reloadTick = this.state.tick + w.reloadTicks;
        return;
      }
      p.ammo[weaponId] -= w.ammoPerShot;
    }
    p.readyTick =
      this.state.tick +
      Math.max(1, Math.ceil(w.cooldownTicks / p.fireRateMultiplier));
    const origin: GameEvent["origin"] = {
      kind: "weapon",
      id: weaponId,
      depth: 0,
    };
    this.emit("weapon.fired", p.id, { weaponId }, undefined, origin);
    if (w.class === "laser") {
      const beam = this.registry.get("beams", w.beamId!);
      const end = this.rayEnd(p, aim, beam.range);
      const targets = this.state.actors
        .filter((a) => a.hp > 0 && a.team !== p.team)
        .map((a) => ({
          a,
          t: segmentCircle(p, end, a, a.radius + beam.width / 2),
        }))
        .filter((v) => v.t !== null)
        .sort((a, b) => a.t! - b.t!);
      for (const hit of targets.slice(0, beam.pierce + 1)) {
        this.damage(
          p.id,
          hit.a.id,
          beam.damage * p.damageMultiplier,
          beam.damageTypeId,
          origin,
        );
        this.emit(
          "beam.hit",
          p.id,
          { weaponId, targetId: hit.a.id },
          hit.a.id,
          origin,
        );
      }
      for (const prop of this.state.props)
        if (!prop.destroyed && segmentCircle(p, end, prop, 16) !== null)
          this.damageProp(
            p.id,
            prop.id,
            beam.damage,
            beam.damageTypeId,
            origin,
          );
      this.state.beams.push({
        id: this.id("beam"),
        from: { x: p.x, y: p.y },
        to: end,
        width: beam.width,
        color: beam.color,
        expires: this.state.tick + beam.durationTicks,
      });
    } else if (w.class === "melee") {
      const melee = w.melee!;
      for (const target of this.state.actors)
        if (
          target.team !== p.team &&
          target.hp > 0 &&
          distanceSq(p, target) < (melee.range + target.radius) ** 2 &&
          Math.abs(
            angleDelta(Math.atan2(target.y - p.y, target.x - p.x), aim),
          ) <=
            (melee.arcDeg * Math.PI) / 360
        ) {
          this.damage(
            p.id,
            target.id,
            melee.damage * p.damageMultiplier,
            melee.damageTypeId,
            origin,
          );
          this.move(
            target,
            (Math.cos(aim) * melee.knockback) / 100,
            (Math.sin(aim) * melee.knockback) / 100,
          );
          this.emit(
            "melee.hit",
            p.id,
            { weaponId, targetId: target.id },
            target.id,
            origin,
          );
        }
      for (const prop of this.state.props)
        if (
          !prop.destroyed &&
          distanceSq(p, prop) < melee.range ** 2 &&
          Math.abs(angleDelta(Math.atan2(prop.y - p.y, prop.x - p.x), aim)) <
            (melee.arcDeg * Math.PI) / 360
        )
          this.damageProp(
            p.id,
            prop.id,
            melee.damage,
            melee.damageTypeId,
            origin,
          );
      this.state.beams.push({
        id: this.id("slash"),
        from: { x: p.x, y: p.y },
        to: {
          x: p.x + Math.cos(aim) * melee.range,
          y: p.y + Math.sin(aim) * melee.range,
        },
        width: 8,
        color: "#c6d1c8",
        expires: this.state.tick + 3,
      });
    } else
      for (let j = 0; j < w.pellets; j++)
        this.spawnProjectile(
          p,
          w.projectileId!,
          aim + ((this.combat.next() - 0.5) * w.spreadDeg * Math.PI) / 180,
          origin,
        );
  }
  private spawnProjectile(
    p: Actor,
    id: string,
    aim: number,
    origin: GameEvent["origin"],
  ) {
    if (this.state.projectiles.length >= 2000) return;
    const def = this.registry.get("projectiles", id);
    this.state.projectiles.push({
      id: this.id("projectile"),
      definitionId: id,
      ownerId: p.id,
      team: p.team,
      x: p.x + Math.cos(aim) * (p.radius + 4),
      y: p.y + Math.sin(aim) * (p.radius + 4),
      vx: Math.cos(aim) * def.speed,
      vy: Math.sin(aim) * def.speed,
      radius: def.radius,
      damage: def.damage * p.damageMultiplier,
      expires: this.state.tick + def.lifetimeTicks,
      pierce: def.pierce,
      ricochets: def.ricochets,
      hitIds: [],
      origin,
    });
    this.emit(
      "projectile.spawned",
      p.id,
      { projectileId: id, weaponId: origin.id },
      undefined,
      origin,
    );
  }
  private rayEnd(p: Vec2, aim: number, range: number) {
    let end = { x: p.x, y: p.y };
    for (let d = 2; d <= range; d += 2) {
      const point = { x: p.x + Math.cos(aim) * d, y: p.y + Math.sin(aim) * d };
      if (circleBlocked(this.state.map, point, 1, true)) break;
      end = point;
    }
    let nearest=1;
    for(const prop of this.state.props){const def=this.registry.get('props',prop.definitionId);if(prop.destroyed||!def.blocksProjectiles)continue;const hit=segmentCollider(p,end,prop,def.collision);if(hit!==null)nearest=Math.min(nearest,hit);}
    end={x:p.x+(end.x-p.x)*nearest,y:p.y+(end.y-p.y)*nearest};
    return end;
  }
  private updateProjectile(p: Projectile) {
    if (p.expires <= this.state.tick) return;
    const def = this.registry.get("projectiles", p.definitionId);
    let speed = Math.hypot(p.vx, p.vy),
      aim = Math.atan2(p.vy, p.vx);
    if (def.homing) {
      const target = this.state.actors
        .filter((a) => a.team !== p.team && a.hp > 0)
        .sort((a, b) => distanceSq(a, p) - distanceSq(b, p))[0];
      if (target)
        aim += clamp(
          angleDelta(Math.atan2(target.y - p.y, target.x - p.x), aim),
          -def.homing / TICK_RATE,
          def.homing / TICK_RATE,
        );
    }
    speed =
      Math.max(0, speed + def.acceleration / TICK_RATE) *
      Math.exp(-def.drag / TICK_RATE);
    p.vx = Math.cos(aim) * speed + def.gravity.x / TICK_RATE;
    p.vy = Math.sin(aim) * speed + def.gravity.y / TICK_RATE;
    const steps = Math.max(1, Math.ceil(speed / TICK_RATE / 4));
    for (let step = 0; step < steps; step++) {
      const from = { x: p.x, y: p.y },
        to = {
          x: p.x + p.vx / TICK_RATE / steps,
          y: p.y + p.vy / TICK_RATE / steps,
        };
      if (circleBlocked(this.state.map, to, p.radius, true)) {
        if (p.ricochets-- > 0) {
          if (
            circleBlocked(this.state.map, { x: to.x, y: p.y }, p.radius, true)
          )
            p.vx = -p.vx;
          else p.vy = -p.vy;
          break;
        }
        this.explode(p);
        p.expires = this.state.tick;
        break;
      }
      p.x = quantize(to.x);
      p.y = quantize(to.y);
      const prop = this.state.props.find(
        (prop) =>
          !prop.destroyed &&
          this.registry.get("props", prop.definitionId).blocksProjectiles &&
          segmentCollider(from, to, prop, this.registry.get('props',prop.definitionId).collision, p.radius) !== null,
      );
      if (prop) {
        this.damageProp(
          p.ownerId,
          prop.id,
          p.damage,
          def.damageTypeId,
          p.origin,
        );
        this.explode(p);
        p.expires = this.state.tick;
        break;
      }
      for (const chest of this.state.chests)
        if (
          chest.state === "closed" &&
          this.registry.get("chests", chest.definitionId).interaction.mode ===
            "damage" &&
          distanceSq(p, chest) < 20 ** 2
        ) {
          const owner = this.state.actors.find((a) => a.id === p.ownerId);
          if (owner) this.openChest(chest, owner);
        }
      const targets = this.state.actors
        .filter(
          (a) => a.hp > 0 && a.team !== p.team && !p.hitIds.includes(a.id),
        )
        .map((a) => ({ a, t: segmentCircle(from, to, a, a.radius + p.radius) }))
        .filter((v) => v.t !== null)
        .sort((a, b) => a.t! - b.t!);
      for (const { a } of targets) {
        p.hitIds.push(a.id);
        this.damage(p.ownerId, a.id, p.damage, def.damageTypeId, p.origin);
        this.emit(
          "projectile.hit",
          p.ownerId,
          { projectileId: p.definitionId, targetId: a.id },
          a.id,
          p.origin,
          { x: p.x, y: p.y },
        );
        if (p.pierce-- <= 0) {
          this.explode(p);
          p.expires = this.state.tick;
          break;
        }
      }
      if (p.expires <= this.state.tick) break;
    }
  }
  private explode(p: Projectile) {
    const def = this.registry.get("projectiles", p.definitionId);
    if (def.explosionRadius <= 0) return;
    for (const a of this.state.actors)
      if (
        a.hp > 0 &&
        a.team !== p.team &&
        distanceSq(p, a) <= def.explosionRadius ** 2
      )
        this.damage(
          p.ownerId,
          a.id,
          p.damage * 0.7,
          def.damageTypeId,
          p.origin,
        );
    for (const prop of this.state.props)
      if (!prop.destroyed && distanceSq(p, prop) <= def.explosionRadius ** 2)
        this.damageProp(
          p.ownerId,
          prop.id,
          p.damage,
          def.damageTypeId,
          p.origin,
        );
  }
  damage(
    ownerId: string,
    targetId: string,
    amount: number,
    damageType: string,
    origin: GameEvent["origin"],
  ) {
    const target = this.state.actors.find((a) => a.id === targetId);
    if (!target || target.hp <= 0 || !Number.isFinite(amount) || amount <= 0)
      return;
    const owner = this.state.actors.find((a) => a.id === ownerId);
    const actual =
      Math.max(1, amount - target.armor) *
      (owner && this.combat.next() < owner.critChance ? 2 : 1);
    target.hp = Math.max(0, quantize(target.hp - actual));
    target.state = target.hp ? "hurt" : "death";
    target.stateTick = this.state.tick;
    this.emit(
      "entity.damaged",
      ownerId,
      { targetId, amount: actual, damageTypeId: damageType },
      targetId,
      origin,
      { x: target.x, y: target.y },
    );
    if (target.hp) return;
    if (target.attackTick) {
      target.attackTick = 0;
      this.emit(
        target.kind === "boss"
          ? "boss.attack_cancelled"
          : "enemy.attack_cancelled",
        target.id,
        {
          [target.kind === "boss" ? "bossId" : "enemyId"]: target.definitionId,
        },
      );
    }
    this.emit(
      "entity.killed",
      ownerId,
      { targetId, definitionId: target.definitionId },
      targetId,
      origin,
      { x: target.x, y: target.y },
    );
    if (target.kind === "player") {
      this.emit("player.death", target.id, {
        characterId: target.definitionId,
      });
      return;
    }
    const def = this.registry.get(
      target.kind === "boss" ? "bosses" : "enemies",
      target.definitionId,
    );
    this.emit(
      target.kind === "boss" ? "boss.killed" : "enemy.killed",
      ownerId,
      { [target.kind === "boss" ? "bossId" : "enemyId"]: target.definitionId },
      targetId,
      origin,
      { x: target.x, y: target.y },
    );
    if (
      target.kind === "boss" &&
      !this.state.progress.bosses.includes(target.definitionId)
    )
      this.state.progress.bosses.push(target.definitionId);
    if (owner?.kind === "player") {
      owner.kills++;
      this.awardExperience(owner, def.xpReward);
    }
    this.drop(def.rewards, def.difficultyRating, target);
  }
  private awardExperience(owner: Actor, amount: number) {
    owner.xp += amount;
    while (owner.xp >= owner.level * 25) {
      owner.xp -= owner.level * 25;
      owner.level++;
      const choices = this.registry.all("mutations").filter(m =>
        owner.mutations.filter(id => id === m.id).length < m.maxStacks
      );
      owner.mutationChoices = [];
      while (choices.length && owner.mutationChoices.length < 3) {
        const pick = this.loot.weighted(choices, m => m.weight);
        owner.mutationChoices.push(pick.id);
        choices.splice(choices.indexOf(pick), 1);
      }
    }
  }
  private damageProp(
    ownerId: string,
    id: string,
    amount: number,
    type: string,
    origin: GameEvent["origin"],
  ) {
    const prop = this.state.props.find((p) => p.id === id);
    if (!prop || prop.destroyed) return;
    const def = this.registry.get("props", prop.definitionId);
    if (!def.destructible) return;
    prop.hp -= amount * (def.resistances[type] ?? 1);
    if (prop.hp <= 0) {
      prop.destroyed = true;
      this.emit(
        "prop.destroyed",
        ownerId,
        { propId: def.id },
        id,
        origin,
        prop,
      );
      if (def.rewards) this.drop(def.rewards, 1, prop);
    }
  }
  private drop(
    rewards: { dropRuleId: string; lootTableId: string },
    rating: number,
    position: Vec2,
    ownerId?: string,
  ) {
    const result = resolveDrops(
      this.registry,
      rewards.dropRuleId,
      rewards.lootTableId,
      rating,
      this.state.depth,
      this.state.actors.filter((a) => a.kind === "player").length > 1,
      this.loot,
    );
    for (const item of result) {
      if (this.state.pickups.length >= 500) break;
      const pickup = {
        id: this.id("loot"),
        ...item,
        x: position.x + (this.loot.next() - 0.5) * 16,
        y: position.y + (this.loot.next() - 0.5) * 16,
        ownerId,
      };
      this.state.pickups.push(pickup);
      this.emit(
        "loot.spawned",
        "world",
        { itemId: item.definitionId },
        pickup.id,
        undefined,
        pickup,
      );
    }
  }
  private openChest(chest: WorldState["chests"][number], p: Actor) {
    if (chest.state !== "closed") return;
    chest.state = "opening";
    chest.openerId = p.id;
    chest.openTick =
      this.state.tick +
      this.registry.get("chests", chest.definitionId).interaction.openTicks;
    this.emit(
      "chest.open_started",
      p.id,
      { chestId: chest.definitionId },
      chest.id,
      undefined,
      chest,
    );
  }
  private updateChests() {
    for (const chest of this.state.chests) {
      const def = this.registry.get("chests", chest.definitionId);
      if (chest.state === "closed" && def.interaction.mode === "proximity") {
        const p = this.state.actors.find(
          (a) =>
            a.kind === "player" &&
            a.hp > 0 &&
            distanceSq(a, chest) < def.interaction.radius ** 2,
        );
        if (p) this.openChest(chest, p);
      }
      if (chest.state === "opening" && this.state.tick >= chest.openTick) {
        chest.state = "opened";
        if (def.policy === "individual_instanced")
          for (const p of this.state.actors.filter((a) => a.kind === "player"))
            this.drop(def.rewards, 1, chest, p.id);
        else this.drop(def.rewards, 1, chest);
        this.emit(
          "chest.opened",
          chest.openerId,
          { chestId: chest.definitionId },
          chest.id,
          undefined,
          chest,
        );
      }
    }
  }
  private updatePickups() {
    const claimed = new Set<string>();
    for (const item of this.state.pickups) {
      const p = this.state.actors.find(
        (a) =>
          a.kind === "player" &&
          a.hp > 0 &&
          (!item.ownerId || item.ownerId === a.id) &&
          distanceSq(a, item) < a.pickupRadius ** 2,
      );
      if (!p) continue;
      if (item.kind === "pickup") {
        const def = this.registry.get("pickups", item.definitionId);
        if (def.kind === "heal") p.hp = Math.min(p.maxHp, p.hp + def.amount);
        if (def.kind === "ammo") p.reserve += def.amount;
        if (def.kind === "xp") this.awardExperience(p, def.amount);
      } else if (item.kind === "weapon") {
        if (!p.weaponIds.includes(item.definitionId)) {
          if (p.weaponIds.length < 5) p.weaponIds.push(item.definitionId);
          else p.weaponIds[p.weaponSlot] = item.definitionId;
          p.ammo[item.definitionId] = this.registry.get(
            "weapons",
            item.definitionId,
          ).magazineSize;
        }
      } else p.mutationChoices = [item.definitionId];
      claimed.add(item.id);
      this.emit(
        "loot.picked_up",
        p.id,
        { itemId: item.definitionId },
        item.id,
        undefined,
        item,
      );
    }
    this.state.pickups = this.state.pickups.filter((p) => !claimed.has(p.id));
  }
  private checkLevel() {
    if (
      this.state.completed ||
      this.state.actors.some((a) => a.team === "enemies" && a.hp > 0)
    )
      return;
    this.state.completed = true;
    const facts = this.state.progress;
    facts.levels.push(this.state.levelId);
    facts.maxDepth = Math.max(facts.maxDepth, this.state.depth);
    this.emit("level.completed", "server", {
      levelId: this.state.levelId,
      biomeId: this.state.map.biomeId,
      depth: this.state.depth,
    });
  }
  private advance(choice?: string) {
    const campaign = this.registry.get("campaigns", this.state.campaignId);
    let edges = campaign.edges.filter(
      (e) =>
        e.fromNodeId === this.state.nodeId &&
        (!e.condition || evaluateCondition(e.condition, this.state.progress)),
    );
    if (!edges.length) throw new Error("No valid campaign transition");
    let edge = edges.find(
      (e) => e.selection === "player_choice" && e.toNodeId === choice,
    );
    if (!edge && edges.some((e) => e.selection === "player_choice")) return;
    edge ??= this.combat.weighted(edges, (e) => e.weight);
    const node = this.resolveNode(
      edge.toNodeId,
      this.combat.state,
      campaign.id,
    );
    const oldBiome = this.state.map.biomeId;
    const newBiome = node.levelId
      ? this.registry.get("levels", node.levelId).biomeId
      : undefined;
    if (
      oldBiome !== newBiome &&
      !this.state.progress.biomes.includes(oldBiome)
    ) {
      this.state.progress.biomes.push(oldBiome);
      this.emit("biome.completed", "server", { biomeId: oldBiome });
    }
    if (node.kind === "end") {
      if (
        campaign.endless &&
        (campaign.maxRepeats === 0 ||
          this.state.repeatCount < campaign.maxRepeats)
      ) {
        this.state.repeatCount++;
        const restart = this.resolveNode(
          campaign.startNodeId,
          this.combat.state,
          campaign.id,
        );
        this.state.nodeId = restart.nodeId;
        this.state.levelId = restart.levelId!;
      } else {
        this.state.status = "victory";
        for (const p of this.state.actors.filter(
          (a) => a.kind === "player" && a.hp > 0,
        )) {
          p.state = "victory";
          p.stateTick = this.state.tick;
          this.emit("player.victory", p.id, { characterId: p.definitionId });
        }
        this.emit("run.completed", "server", { campaignId: campaign.id });
        return;
      }
    } else {
      this.state.nodeId = node.nodeId;
      this.state.levelId = node.levelId!;
    }
    this.state.depth++;
    this.state.progress.maxDepth = this.state.depth;
    this.state.map = generateLevel(
      this.registry,
      this.state.levelId,
      this.state.seed + this.state.depth * 7919,
      { depth: this.state.depth, difficultyScale: campaign.nodes.find(n=>n.nodeId===this.state.nodeId)!.difficultyScale },
    );
    this.state.projectiles = [];
    this.state.props = [];
    this.state.chests = [];
    this.state.pickups = [];
    this.state.beams = [];
    this.state.completed = false;
    this.state.actors = this.state.actors.filter((a) => a.kind === "player");
    for (const p of this.state.actors) {
      if(p.departed)continue;
      p.x = this.state.map.spawn.x;
      p.y = this.state.map.spawn.y;
      p.hp = Math.max(p.hp, p.maxHp * 0.25);
      p.state = "idle";
      p.path = [];
      p.attackTick = 0;
    }
    this.populate();
    this.emit("level.started", "server", {
      levelId: this.state.levelId,
      biomeId: this.state.map.biomeId,
    });
  }
  private action(owner: Actor, action: EffectAction, event: GameEvent) {
    switch (action.type) {
      case "heal":
        owner.hp = Math.min(owner.maxHp, owner.hp + action.amount);
        this.emit("entity.healed", owner.id, {
          targetId: owner.id,
          amount: action.amount,
        });
        break;
      case "damage":
        for (const target of this.state.actors)
          if (
            target.hp > 0 &&
            target.team !== owner.team &&
            distanceSq(event.position, target) <= action.radius ** 2
          )
            this.queuedDamage.push({
              ownerId: owner.id,
              targetId: target.id,
              amount: action.amount,
              damageType: action.damageTypeId,
              origin: {
                kind: "mutation",
                id: event.origin.id,
                depth: event.origin.depth + 1,
              },
            });
        break;
      case "modify_stat": {
        const key = {
          maxHealth: "maxHp",
          moveSpeed: "speed",
          damageMultiplier: "damageMultiplier",
          fireRateMultiplier: "fireRateMultiplier",
          armor: "armor",
          critChance: "critChance",
          pickupRadius: "pickupRadius",
        }[action.stat] as "maxHp";
        owner[key] = clamp(
          action.operation === "add"
            ? owner[key] + action.value
            : owner[key] * action.value,
          0,
          100000,
        );
        break;
      }
      case "apply_status":
        if (event.targetId) {
          const target = this.state.actors.find((a) => a.id === event.targetId);
          if (target?.hp)
            target.statuses.push({
              id: action.statusId,
              until: this.state.tick + action.durationTicks,
              nextTick: this.state.tick + 1,
              ownerId: owner.id,
            });
        }
        break;
      case "grant_ammo":
        owner.reserve += action.amount;
        break;
      case "spawn_projectile":
        for (let i = 0; i < action.count; i++)
          this.spawnProjectile(
            owner,
            action.projectileId,
            owner.aim + (i * Math.PI * 2) / action.count,
            {
              kind: "mutation",
              id: event.origin.id,
              depth: event.origin.depth + 1,
            },
          );
    }
  }
  private processEffects() {
    const due = this.state.delayed.filter((d) => d.tick <= this.state.tick);
    this.state.delayed = this.state.delayed.filter(
      (d) => d.tick > this.state.tick,
    );
    for (const d of due) {
      const owner = this.state.actors.find(
        (a) => a.id === d.ownerId && a.hp > 0,
      );
      if (owner) this.runGraph(owner, d.effectId, d.event, d.nodeId);
    }
    this.flushDamage();
    for (
      let index = 0;
      index < this.state.events.length && index < 256;
      index++
    ) {
      const event = this.state.events[index];
      if (event.origin.depth >= 4) continue;
      for (const owner of this.state.actors.filter(
        (a) => a.kind === "player" && a.hp > 0,
      ))
        for (const mutationId of owner.mutations) {
          const mutation = this.registry.get("mutations", mutationId);
          for (const id of mutation.effectIds) {
            const effect = this.registry.get("effects", id);
            if (
              effect.event !== event.type ||
              event.actorId !== owner.id ||
              event.origin.kind === "mutation"
            )
              continue;
            const state = (owner.effectState[id] ??= {});
            if (
              Number(state.readyTick ?? 0) > this.state.tick ||
              !effect.conditions.every((c) => conditionMatches(c, event)) ||
              this.combat.next() >= effect.probability
            )
              continue;
            state.readyTick = this.state.tick + effect.cooldownTicks;
            if (effect.mode === "builtin")
              for (const action of effect.actions)
                if (action.type !== "modify_stat")
                  this.action(owner, action, event);
            if (effect.mode === "graph") this.runGraph(owner, id, event);
            if (effect.mode === "custom_extension") {
              const ext = extensions.find(
                (x) => x.meta.id === effect.extensionId,
              );
              if (!ext || !extensionValidators.get(ext.meta.id)!(effect.params))
                throw new Error("Invalid extension parameters");
              const initial =
                Object.keys(state).length <= 1
                  ? ext.handler.initialState()
                  : state;
              const next = ext.handler.onEvent(
                this.context(owner, event),
                event,
                effect.params as Parameters<typeof ext.handler.onEvent>[2],
                initial as ReturnType<typeof ext.handler.initialState>,
              );
              owner.effectState[id] = { ...next, readyTick: state.readyTick };
            }
          }
        }
      this.flushDamage();
    }
  }
  private flushDamage(){const commands=this.queuedDamage.splice(0,128);this.queuedDamage=[];for(const command of commands)this.damage(command.ownerId,command.targetId,command.amount,command.damageType,command.origin);}
  private runGraph(
    owner: Actor,
    id: string,
    event: GameEvent,
    nodeId?: string,
  ) {
    const effect = this.registry.get("effects", id),
      graph = this.registry.get("graphs", effect.graphId!);
    executeGraph(
      graph,
      event,
      {
        tick: this.state.tick,
        random: () => this.combat.next(),
        state: (owner.effectState[id] ??= {}),
        action: (a) => this.action(owner, a, event),
        delay: (node, ticks) => {
          if (this.state.delayed.length < 256)
            this.state.delayed.push({
              tick: this.state.tick + Math.max(1, ticks),
              ownerId: owner.id,
              effectId: id,
              nodeId: node,
              event,
            });
        },
      },
      nodeId,
    );
  }
  private context(owner: Actor, event: GameEvent): MutationContext {
    const view = (a: Actor | undefined): EntityView | null =>
      a
        ? Object.freeze({
            id: a.id,
            team: a.team,
            x: a.x,
            y: a.y,
            alive: a.hp > 0,
          })
        : null;
    let commands = 0;
    return {
      ownerId: owner.id,
      tick: this.state.tick,
      tickRate: TICK_RATE,
      owner: () => view(owner),
      getEntity: (id) => view(this.state.actors.find((a) => a.id === id)),
      entitiesInRadius: (id, radius) => {
        const p = this.state.actors.find((a) => a.id === id);
        return p
          ? this.state.actors
              .filter((a) => distanceSq(a, p) <= Math.min(radius, 500) ** 2)
              .map((a) => view(a)!)
          : [];
      },
      isEnemyOf: (target, source) => {
        const a = this.state.actors.find((a) => a.id === target),
          b = this.state.actors.find((a) => a.id === source);
        return !!a && !!b && a.team !== b.team;
      },
      random01: () => this.combat.next(),
      emitDamage: (c) => {
        if (
          ++commands > 8 ||
          c.sourceId !== owner.id ||
          !Number.isFinite(c.amount) ||
          c.amount < 0 ||
          c.amount > 200
        )
          return;
        this.queuedDamage.push({
          ownerId: owner.id,
          targetId: c.targetId,
          amount: c.amount,
          damageType: c.damageTypeId,
          origin: {
            kind: "mutation",
            id: c.originExtensionId,
            depth: event.origin.depth + 1,
          },
        });
      },
      emitVfx: (c) => {
        this.emit("mutation.activated", owner.id, {
          mutationId: event.origin.id,
          effectId: c.effectId,
        });
      },
    };
  }
}
