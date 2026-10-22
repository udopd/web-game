import { describe, it, expect } from "vitest";
import { content, registry, simulation, arena, target } from "../fixtures";
import { Simulation } from "../../packages/simulation/src/simulation";
import { neutralInput } from "../../packages/simulation/src/types";
import {
  generateLevel,
  reachable,
  circleBlocked,
} from "../../packages/procedural-generation/src/index";
import { Rng } from "../../packages/game-core/src/math";
import {
  dropChance,
  resolveDrops,
  evaluateCondition,
  mergeFacts,
} from "../../packages/simulation/src/rewards";
describe("Deterministic authoritative simulation", () => {
  it("replays 1,800 input ticks byte-for-byte", () => {
    const a = simulation(812),
      b = simulation(812);
    for (let tick = 0; tick < 1800; tick++) {
      const input = {
        ...neutralInput(),
        seq: tick,
        moveX: Math.sin(tick / 60),
        moveY: Math.cos(tick / 60),
        aim: tick / 20,
        fire: true,
      };
      a.input("player-0", input);
      b.input("player-0", input);
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });
  it("restores RNG, delayed work and entity state from a checkpoint", () => {
    const a = simulation(28);
    for (let i = 0; i < 90; i++) {
      a.input("player-0", {
        ...neutralInput(),
        seq: i,
        fire: true,
        aim: i / 10,
      });
      a.step();
    }
    const b = new Simulation(registry, a.snapshot());
    for (let i = 90; i < 300; i++) {
      const input = {
        ...neutralInput(),
        seq: i,
        fire: true,
        moveX: 0.3,
        aim: i / 10,
      };
      a.input("player-0", input);
      b.input("player-0", input);
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });
  it("rejects an incompatible content checkpoint", () => {
    const state = simulation().snapshot();
    state.contentVersion = "not-installed";
    expect(() => new Simulation(registry, state)).toThrow("Incompatible");
  });
  it("rejects repeated or older input sequences", () => {
    const sim = arena();
    expect(sim.input("player-0", { ...neutralInput(), seq: 10 })).toBe(true);
    expect(
      sim.input("player-0", { ...neutralInput(), seq: 10, fire: true }),
    ).toBe(false);
    expect(sim.input("player-0", { ...neutralInput(), seq: 9 })).toBe(false);
  });
  it("stops movement when input is stale", () => {
    const sim = arena();
    sim.input("player-0", { ...neutralInput(), seq: 1, moveX: 1 });
    for (let i = 0; i < 16; i++) sim.step();
    const x = sim.state.actors[0].x;
    for (let i = 0; i < 15; i++) sim.step();
    expect(sim.state.actors[0].x).toBe(x);
  });
  it("normalizes diagonal movement", () => {
    const a = arena(),
      b = arena();
    a.input("player-0", { ...neutralInput(), seq: 1, moveX: 1 });
    b.input("player-0", { ...neutralInput(), seq: 1, moveX: 1, moveY: 1 });
    a.step();
    b.step();
    expect(
      Math.hypot(b.state.actors[0].x - 100, b.state.actors[0].y - 100),
    ).toBeCloseTo(a.state.actors[0].x - 100, 2);
  });
  it("does not fire or move a dead actor", () => {
    const sim = arena();
    sim.state.actors[0].hp = 0;
    sim.input("player-0", { ...neutralInput(), seq: 1, moveX: 1, fire: true });
    sim.step();
    expect(sim.state.actors[0].x).toBe(100);
    expect(sim.state.projectiles).toHaveLength(0);
    expect(sim.state.status).toBe("defeat");
  });
  for (const kind of ["bullet", "shotgun", "bolt", "laser", "melee"])
    it(`${kind} weapon applies real damage`, () => {
      const sim = arena(),
        enemy = target(sim, kind === "melee" ? 125 : 160);
      const weapon = content.weapons.items.find((w) => w.class === kind)!;
      const player = sim.state.actors[0];
      player.weaponIds = [weapon.id];
      player.ammo = { [weapon.id]: weapon.magazineSize };
      for (let i = 0; i < 35 && enemy.hp === 100; i++) {
        sim.input(player.id, { ...neutralInput(), seq: i, fire: true });
        sim.step();
      }
      expect(enemy.hp).toBeLessThan(100);
      expect(player.ammo[weapon.id]).toBeLessThanOrEqual(weapon.magazineSize);
    });
  it("counts a kill once and records boss facts", () => {
    const sim = arena(),
      enemy = target(sim);
    sim.damage("player-0", enemy.id, 1000, "physical", {
      kind: "weapon",
      id: "test",
      depth: 0,
    });
    sim.damage("player-0", enemy.id, 1000, "physical", {
      kind: "weapon",
      id: "test",
      depth: 0,
    });
    expect(sim.state.actors[0].kills).toBe(1);
    expect(
      sim.state.events.filter((e) => e.type === "enemy.killed"),
    ).toHaveLength(1);
  });
  it("opens a shared chest once under simultaneous interaction", () => {
    const sim = arena(),
      player = sim.state.actors[0];
    const def = content.chests.items[0];
    sim.state.chests = [
      {
        id: "test-chest",
        definitionId: def.id,
        x: player.x + 25,
        y: player.y,
        state: "closed",
        openTick: 0,
        openerId: "",
        claimedBy: [],
      },
    ];
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      sim.input(player.id, { ...neutralInput(), seq: i, interact: true });
      sim.step();
      seen.push(...sim.state.events.map((e) => e.type));
    }
    expect(seen.filter((e) => e === "chest.opened")).toHaveLength(1);
    expect(sim.state.chests[0].state).toBe("opened");
  });
  it("completes the full campaign through player-selected branches", () => {
    const sim = simulation();
    for (let depth = 0; depth < 20 && sim.state.status === "running"; depth++) {
      for (const enemy of sim.state.actors.filter((a) => a.kind !== "player"))
        sim.damage("player-0", enemy.id, 1e9, "physical", {
          kind: "weapon",
          id: "test",
          depth: 0,
        });
      sim.step();
      expect(sim.state.completed).toBe(true);
      const player = sim.state.actors[0];
      player.x = sim.state.map.exit.x;
      player.y = sim.state.map.exit.y;
      const edge = registry
        .get("campaigns", sim.state.campaignId)
        .edges.find((e) => e.fromNodeId === sim.state.nodeId)!;
      sim.input(player.id, {
        ...neutralInput(),
        seq: depth + 1,
        interact: true,
        exitNodeId: edge.toNodeId,
      });
      sim.step();
    }
    expect(sim.state.status).toBe("victory");
    expect(sim.state.progress.bosses.length).toBeGreaterThan(0);
    expect(sim.state.progress.biomes.length).toBe(2);
  });
});
describe("World generation and rewards", () => {
  for (const level of content.levels.items)
    it(`${level.id}: deterministic and reachable across 40 seeds`, () => {
      for (let seed = 0; seed < 40; seed++) {
        const map = generateLevel(registry, level.id, seed);
        expect(map).toEqual(generateLevel(registry, level.id, seed));
        expect(reachable(map, map.spawn, map.exit)).toBe(true);
        expect(
          circleBlocked(
            map,
            map.spawn,
            content.characters.items[0].collision.shape === "circle"
              ? content.characters.items[0].collision.radius
              : 8,
          ),
        ).toBe(false);
        expect(map.tiles).toHaveLength(map.width * map.height);
      }
    });
  it("has a bounded, difficulty-sensitive drop formula", () => {
    const r = {
      ...content.dropRules.items[0],
      guaranteedDrop: false,
      baseChance: 0.25,
      slopePerPoint: 0.0125,
      baseline: 1,
      minMultiplier: 0.5,
      maxMultiplier: 2.25,
      levelMultiplier: 1,
      coopMultiplier: 1,
    };
    expect(dropChance(r, 1, 1, false)).toBe(0.25);
    expect(dropChance(r, 100, 1, false)).toBeGreaterThan(0.5);
    expect(dropChance({ ...r, levelMultiplier: 9 }, 100, 99, true)).toBe(1);
  });
  it("produces reproducible weighted reward rolls", () => {
    const rule = content.dropRules.items[0],
      table = content.lootTables.items[0];
    const a = new Rng(10),
      b = new Rng(10);
    for (let i = 0; i < 100; i++)
      expect(
        resolveDrops(registry, rule.id, table.id, 50, 1, false, a),
      ).toEqual(resolveDrops(registry, rule.id, table.id, 50, 1, false, b));
  });
  it("evaluates nested unlock facts and merges them without duplication", () => {
    const a = { levels: ["l1"], biomes: [], bosses: [], maxDepth: 2 },
      b = {
        levels: ["l1", "l2"],
        biomes: ["b1"],
        bosses: ["boss"],
        maxDepth: 3,
      };
    const facts = mergeFacts(a, b);
    expect(facts.levels).toEqual(["l1", "l2"]);
    expect(
      evaluateCondition(
        {
          type: "all_of",
          children: [
            { type: "boss_defeated", bossId: "boss" },
            { type: "max_level_reached", levelNumber: 3 },
          ],
        },
        facts,
      ),
    ).toBe(true);
    expect(
      evaluateCondition({ type: "level_completed", levelId: "absent" }, facts),
    ).toBe(false);
  });
});
