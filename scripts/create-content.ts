import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import {
  definitions,
  CONTENT_PATHS,
  type Content,
  type CollectionName,
  type Definition,
  collectionSchemas,
} from "../packages/content-schemas/src/definitions";
import { assertContent } from "../packages/content-schemas/src/validate";
const content = Object.fromEntries(
  Object.keys(definitions).map((k) => [
    k,
    { schemaVersion: "1.0.0", items: [] },
  ]),
) as unknown as Content;
const add = <K extends CollectionName>(k: K, item: Definition<K>) => {
  (content[k].items as Definition<K>[]).push(item);
  return item.id;
};
const base = (id: string, name = id) => ({ id, name, tags: [] as string[] });
const stats = (hp = 100, speed = 110) => ({
  maxHealth: hp,
  moveSpeed: speed,
  armor: 0,
  damageMultiplier: 1,
  fireRateMultiplier: 1,
  critChance: 0.05,
  pickupRadius: 24,
});
const source = "assets/sprites/scout.png";
const meta = await sharp(
  await readFile("content/base-game/" + source),
).metadata();
function sprite(
  id: string,
  source: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size = 32,
  layer: "characters" | "props" | "floor" = "characters",
) {
  return add("sprites", {
    ...base(id),
    source,
    frame: { x, y, width, height },
    pivot: { x: width / 2, y: height * 0.82 },
    renderScale: size / width,
    rotationOffsetDeg: 0,
    layer,
  });
}
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++) {
    const xx = Math.floor((x * meta.width!) / 4),
      yy = Math.floor((y * meta.height!) / 4),
      w = Math.floor(((x + 1) * meta.width!) / 4) - xx,
      h = Math.floor(((y + 1) * meta.height!) / 4) - yy;
    sprite(`scout_${y * 4 + x}`, source, xx, yy, w, h);
  }
const objects = [
  "beetle",
  "spore",
  "sentry",
  "reactor",
  "revolver",
  "shotgun",
  "crossbow",
  "laser",
  "blade",
  "crate",
  "crate_broken",
  "chest",
  "chest_open",
  "crystal",
  "ammo",
  "spark",
];
const objectMeta = await sharp(
  "content/base-game/assets/sprites/objects.png",
).metadata();
objects.forEach((id, j) => {
  const x = j % 4,
    y = Math.floor(j / 4),
    xx = Math.floor((x * objectMeta.width!) / 4),
    yy = Math.floor((y * objectMeta.height!) / 4);
  sprite(
    id,
    "assets/sprites/objects.png",
    xx,
    yy,
    Math.floor(((x + 1) * objectMeta.width!) / 4) - xx,
    Math.floor(((y + 1) * objectMeta.height!) / 4) - yy,
    id === "reactor" ? 72 : id === "spark" ? 8 : 32,
    "props",
  );
});
const tileMeta = await sharp(
  "content/base-game/assets/sprites/terrain.png",
).metadata();
for (let j = 0; j < 16; j++) {
  const x = j % 4,
    y = Math.floor(j / 4),
    xx = Math.floor((x * tileMeta.width!) / 4),
    yy = Math.floor((y * tileMeta.height!) / 4);
  sprite(
    `tile_${j}`,
    "assets/sprites/terrain.png",
    xx,
    yy,
    Math.floor(((x + 1) * tileMeta.width!) / 4) - xx,
    Math.floor(((y + 1) * tileMeta.height!) / 4) - yy,
    16,
    "floor",
  );
}
function clip(id: string, frames: string[], loop = true) {
  return add("animations", {
    ...base(id),
    loop,
    holdLastFrame: !loop,
    defaultFrameDurationMs: 120,
    direction: "any",
    frames: frames.map((spriteId) => ({
      spriteId,
      durationMs: 120,
      offset: { x: 0, y: 0 },
      events: [],
    })),
  });
}
const animationSet = {
  idle: clip("scout_idle", ["scout_0", "scout_1", "scout_2", "scout_3"]),
  run: clip("scout_run", ["scout_4", "scout_5", "scout_6", "scout_7"]),
  hurt: clip("scout_hurt", ["scout_8", "scout_9"], false),
  death: clip("scout_death", ["scout_10", "scout_11"], false),
  victory: clip(
    "scout_victory",
    ["scout_12", "scout_13", "scout_14", "scout_15"],
    false,
  ),
};
for (const id of ["physical", "energy", "electric", "melee", "poison"])
  add("damageTypes", base(id));
for (const [id, speed, damage, pierce] of [
  ["bullet", 420, 14, 0],
  ["pellet", 340, 7, 0],
  ["bolt", 550, 28, 2],
  ["enemy_bullet", 160, 9, 0],
] as const)
  add("projectiles", {
    ...base(id),
    spriteId: "spark",
    speed,
    acceleration: 0,
    radius: 3,
    damage,
    damageTypeId: "physical",
    lifetimeTicks: 90,
    pierce,
    ricochets: 0,
    explosionRadius: 0,
    gravity: { x: 0, y: 0 },
    drag: 0,
    homing: 0,
  });
add("beams", {
  ...base("beam"),
  range: 260,
  width: 5,
  damage: 12,
  damageTypeId: "energy",
  pierce: 2,
  color: "#a581d2",
  durationTicks: 3,
});
for (const [id, type, projectile, cooldown, pellets, spread] of [
  ["revolver", "bullet", "bullet", 8, 1, 3],
  ["shotgun", "shotgun", "pellet", 22, 7, 36],
  ["crossbow", "bolt", "bolt", 18, 1, 0],
  ["laser", "laser", null, 6, 1, 0],
  ["blade", "melee", null, 14, 1, 0],
] as const)
  add("weapons", {
    ...base(
      id,
      {
        revolver: "Copper Six",
        shotgun: "Briar Scatter",
        crossbow: "Needle Driver",
        laser: "Prism Coil",
        blade: "Salvager",
      }[id],
    ),
    spriteId: id,
    class: type,
    cooldownTicks: cooldown,
    magazineSize: type === "melee" ? 1 : 12,
    reloadTicks: 35,
    ammoPerShot: type === "melee" ? 0 : 1,
    spreadDeg: spread,
    pellets,
    ...(projectile
      ? { projectileId: projectile }
      : type === "laser"
        ? { beamId: "beam" }
        : {
            melee: {
              range: 42,
              arcDeg: 110,
              damage: 34,
              damageTypeId: "melee",
              knockback: 50,
            },
          }),
  });
add("weapons", {
  ...base("enemy_spitter"),
  spriteId: "revolver",
  class: "bullet",
  cooldownTicks: 30,
  magazineSize: 100,
  reloadTicks: 30,
  ammoPerShot: 0,
  spreadDeg: 4,
  pellets: 1,
  projectileId: "enemy_bullet",
});
add("characters", {
  ...base("moss", "Moss"),
  description: "A salvage scout from the overgrown frontier.",
  spriteId: "scout_0",
  animationSet,
  collision: { shape: "circle", radius: 7 },
  stats: stats(110, 130),
  startingWeaponIds: ["revolver", "blade"],
  unlockRuleId: null,
  facingMode: "horizontal_flip",
});
add("characters", {
  ...base("prism", "Prism"),
  description: "Clear the Foundry to awaken this energy specialist.",
  spriteId: "scout_0",
  animationSet,
  collision: { shape: "circle", radius: 7 },
  stats: stats(85, 155),
  startingWeaponIds: ["laser", "crossbow"],
  unlockRuleId: "unlock_prism",
  facingMode: "horizontal_flip",
});
add("pickups", {
  ...base("health"),
  spriteId: "crystal",
  kind: "heal",
  amount: 30,
});
add("pickups", {
  ...base("ammo_pickup"),
  spriteId: "ammo",
  kind: "ammo",
  amount: 40,
});
add("dropRules", {
  ...base("common_drop"),
  baseChance: 0.55,
  slopePerPoint: 0.0125,
  baseline: 1,
  minMultiplier: 0.5,
  maxMultiplier: 2.25,
  levelMultiplier: 1,
  coopMultiplier: 1.5,
  rollsMin: 1,
  rollsMax: 1,
  guaranteedDrop: false,
});
add("dropRules", {
  ...base("guaranteed"),
  baseChance: 1,
  slopePerPoint: 0,
  baseline: 1,
  minMultiplier: 1,
  maxMultiplier: 1,
  levelMultiplier: 1,
  coopMultiplier: 1,
  rollsMin: 2,
  rollsMax: 3,
  guaranteedDrop: true,
});
add("lootTables", {
  ...base("field_supplies"),
  entries: [
    { rewardType: "pickup", rewardId: "health", weight: 35, min: 1, max: 1 },
    {
      rewardType: "pickup",
      rewardId: "ammo_pickup",
      weight: 65,
      min: 1,
      max: 1,
    },
  ],
});
add("lootTables", {
  ...base("arsenal"),
  entries: ["revolver", "shotgun", "crossbow", "laser", "blade"].map(
    (rewardId) => ({
      rewardType: "weapon" as const,
      rewardId,
      weight: 1,
      min: 1,
      max: 1,
    }),
  ),
});
const rewards = { dropRuleId: "common_drop", lootTableId: "field_supplies" };
for (const [id, mode, range] of [
  ["hunter", "chase", 24],
  ["spitter", "ranged", 140],
  ["orbit", "orbit", 120],
] as const)
  add("behaviors", {
    ...base(id),
    mode,
    detectionRange: 600,
    preferredRange: range,
    strafe: mode === "orbit" ? 0.5 : 0,
    navigation: true,
  });
add("attackPatterns", {
  ...base("bite"),
  weaponId: "blade",
  windupTicks: 14,
  recoveryTicks: 35,
  shots: 1,
  spreadDeg: 0,
  aim: "target",
  summonCount: 0,
});
add("attackPatterns", {
  ...base("spit"),
  weaponId: "enemy_spitter",
  windupTicks: 18,
  recoveryTicks: 40,
  shots: 1,
  spreadDeg: 0,
  aim: "target",
  summonCount: 0,
});
add("attackPatterns", {
  ...base("radial"),
  weaponId: "enemy_spitter",
  windupTicks: 28,
  recoveryTicks: 50,
  shots: 10,
  spreadDeg: 360,
  aim: "radial",
  summonCount: 0,
});
add("attackPatterns", {
  ...base("reinforcements"),
  weaponId: "enemy_spitter",
  windupTicks: 25,
  recoveryTicks: 90,
  shots: 3,
  spreadDeg: 15,
  aim: "target",
  summonEnemyId: "beetle_enemy",
  summonCount: 2,
});
for (const [id, spriteId, hp, speed, behaviorId, pattern] of [
  ["beetle_enemy", "beetle", 35, 70, "hunter", "bite"],
  ["spore_enemy", "spore", 50, 45, "spitter", "spit"],
  ["sentry_enemy", "sentry", 85, 55, "orbit", "spit"],
] as const)
  add("enemies", {
    ...base(id),
    spriteId,
    animationSet: {
      idle: clip(id + "_idle", [spriteId]),
      run: clip(id + "_run", [spriteId]),
      hurt: clip(id + "_hurt", [spriteId], false),
      death: clip(id + "_death", [spriteId], false),
    },
    collision: { shape: "circle", radius: 8 },
    stats: stats(hp, speed),
    behaviorId,
    attackPatternIds: [pattern],
    difficultyRating: 10,
    contactDamage: 6,
    xpReward: 10,
    rewards,
  });
add("bosses", {
  ...base("furnace", "The Last Furnace"),
  spriteId: "reactor",
  animationSet: {
    idle: clip("reactor_idle", ["reactor"]),
    death: clip("reactor_death", ["reactor"], false),
  },
  collision: { shape: "circle", radius: 20 },
  stats: stats(650, 40),
  difficultyRating: 85,
  contactDamage: 16,
  xpReward: 100,
  rewards: { dropRuleId: "guaranteed", lootTableId: "arsenal" },
  phases: [
    {
      id: "embers",
      minHealthRatio: 0.5,
      behaviorId: "spitter",
      attackPatternIds: ["radial"],
    },
    {
      id: "overload",
      minHealthRatio: 0,
      behaviorId: "orbit",
      attackPatternIds: ["radial", "reinforcements"],
    },
  ],
});
add("props", {
  ...base("supply_crate"),
  spriteId: "crate",
  destroyedSpriteId: "crate_broken",
  collision: { shape: "box", width: 14, height: 14 },
  blocksMovement: true,
  blocksProjectiles: true,
  blocksLineOfSight: true,
  destructible: true,
  maxHealth: 22,
  resistances: { physical: 1, energy: 1, melee: 2 },
  rewards,
});
add("chests", {
  ...base("weapon_cache"),
  spriteId: "chest",
  animationSet: {
    idle: clip("chest_idle", ["chest"]),
    open: clip("chest_open_anim", ["chest", "chest_open"], false),
  },
  collision: { shape: "box", width: 20, height: 16 },
  interaction: { mode: "interact", radius: 40, openTicks: 10 },
  rewards: { dropRuleId: "guaranteed", lootTableId: "arsenal" },
  policy: "shared_world",
});
add("statuses", {
  ...base("toxic"),
  durationTicks: 90,
  tickInterval: 30,
  damagePerTick: 3,
  damageTypeId: "poison",
  speedMultiplier: 0.8,
  stun: false,
});
add("effects", {
  ...base("vigor_effect"),
  mode: "builtin",
  event: "entity.killed",
  probability: 1,
  cooldownTicks: 0,
  conditions: [],
  actions: [{ type: "heal", amount: 4 }],
});
add("effects", {
  ...base("stride_effect"),
  mode: "builtin",
  event: "mutation.activated",
  probability: 1,
  cooldownTicks: 0,
  conditions: [],
  actions: [
    {
      type: "modify_stat",
      stat: "moveSpeed",
      operation: "multiply",
      value: 1.2,
    },
  ],
});
add("effects", {
  ...base("chain_effect"),
  mode: "custom_extension",
  event: "entity.killed",
  probability: 1,
  cooldownTicks: 36,
  conditions: [],
  actions: [],
  extensionId: "ext.chain_lightning",
  extensionVersion: "1.0.0",
  params: {
    radius: 160,
    maxJumps: 3,
    damage: 12,
    cooldownTicks: 36,
    damageTypeId: "electric",
    vfxId: "sparks",
  },
});
for (const [id, effectId, name, description] of [
  ["vigor", "vigor_effect", "Second Breath", "Recover 4 health after a kill."],
  ["stride", "stride_effect", "Ghost Step", "Move 20% faster."],
  [
    "chain",
    "chain_effect",
    "Arc Bloom",
    "Kills chain electricity to nearby enemies.",
  ],
] as const)
  add("mutations", {
    ...base(id, name),
    description,
    iconSpriteId: "crystal",
    maxStacks: 2,
    weight: 1,
    effectIds: [effectId],
  });
add("graphs", {
  ...base("healing_graph"),
  event: "entity.killed",
  nodes: [
    { id: "event", type: "event" },
    { id: "chance", type: "chance", probability: 0.5 },
    { id: "heal", type: "action", action: { type: "heal", amount: 8 } },
  ],
  edges: [
    { from: "event", to: "chance" },
    { from: "chance", to: "heal" },
  ],
});
add("effects", {
  ...base("lucky_effect"),
  mode: "graph",
  event: "entity.killed",
  probability: 1,
  cooldownTicks: 0,
  conditions: [],
  actions: [],
  graphId: "healing_graph",
});
add("mutations", {
  ...base("lucky", "Lucky Clover"),
  description: "Half of your kills heal 8 HP.",
  iconSpriteId: "crystal",
  maxStacks: 1,
  weight: 1,
  effectIds: ["lucky_effect"],
});
add("particles", {
  ...base("sparks"),
  spriteId: "spark",
  emission: {
    mode: "burst",
    count: 12,
    ratePerSecond: 0,
    durationMs: 0,
    maxAlive: 100,
    shape: "point",
    shapeRadius: 0,
    directionDeg: 0,
    spreadDeg: 360,
  },
  motion: {
    speed: { min: 35, max: 100 },
    acceleration: { x: 0, y: 0 },
    gravity: { x: 0, y: 40 },
    dragPerSecond: 1.4,
    rotationDeg: { min: 0, max: 360 },
    angularVelocityDegPerSecond: { min: -180, max: 180 },
    alignToVelocity: false,
  },
  lifetimeMs: { min: 180, max: 450 },
  sizeOverLife: [
    { t: 0, value: 1 },
    { t: 1, value: 0 },
  ],
  alphaOverLife: [
    { t: 0, value: 1 },
    { t: 1, value: 0 },
  ],
  collision: { mode: "none", restitution: 0 },
  color: "#eeb75a",
  priority: 50,
});
add("cameraEffects", {
  ...base("impact"),
  durationMs: 90,
  amplitudePx: 3,
  frequencyHz: 24,
  falloff: "easeOut",
  stacking: "max",
  maxDistance: 600,
});
await mkdir("content/base-game/assets/audio", { recursive: true });
function wav(seconds: number, music = false) {
  const sampleRate = 22050,
    count = Math.floor(seconds * sampleRate),
    data = Buffer.alloc(44 + count * 2);
  data.write("RIFF");
  data.writeUInt32LE(36 + count * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(count * 2, 40);
  for (let j = 0; j < count; j++) {
    const t = j / sampleRate,
      beat = Math.floor(t * 2),
      note = [110, 130.81, 164.81, 146.83, 110, 164.81, 196, 146.83][beat % 8];
    const sample = music
      ? (Math.sin(t * note * Math.PI * 2) * 0.12 +
          Math.sin(t * note * 2 * Math.PI * 2) * 0.04) *
        (0.7 + 0.3 * Math.sin(t * Math.PI * 4))
      : Math.sin(t * (220 - (150 * t) / seconds) * Math.PI * 2) *
        Math.exp(-t * 35) *
        0.4;
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
      44 + j * 2,
    );
  }
  return data;
}
await writeFile("content/base-game/assets/audio/shot.wav", wav(0.18));
await writeFile("content/base-game/assets/audio/frontier.wav", wav(8, true));
add("sounds", {
  ...base("shot"),
  source: "assets/audio/shot.wav",
  baseGain: 0.5,
  pitch: { min: 0.9, max: 1.1 },
  loop: false,
  spatial: { enabled: true, referenceDistance: 160, maxDistance: 900 },
  cooldownMs: 40,
  maxConcurrent: 8,
  priority: 80,
});
add("music", {
  ...base("frontier"),
  source: "assets/audio/frontier.wav",
  baseGain: 0.3,
  loop: true,
  loopStartMs: 0,
  loopEndMs: 8000,
  fadeInMs: 600,
  fadeOutMs: 800,
});
add("eventBindings", {
  ...base("fire_fx"),
  event: "weapon.fired",
  conditions: [],
  actions: [
    { type: "play_sfx", soundId: "shot" },
    { type: "camera_effect", cameraEffectId: "impact", scope: "local_actor" },
  ],
  cooldownMs: 0,
  probability: 1,
  enabled: true,
});
add("eventBindings", {
  ...base("hit_fx"),
  event: "projectile.hit",
  conditions: [],
  actions: [{ type: "spawn_particles", particleEffectId: "sparks" }],
  cooldownMs: 0,
  probability: 1,
  enabled: true,
});
add("eventBindings", {
  ...base("level_music"),
  event: "level.started",
  conditions: [],
  actions: [{ type: "switch_music", musicId: "frontier" }],
  cooldownMs: 0,
  probability: 1,
  enabled: true,
});
for (const [id, offset, bg] of [
  ["overgrowth", 0, "#182822"],
  ["foundry", 8, "#2b201d"],
] as const) {
  add("tilePalettes", {
    ...base(id + "_tiles"),
    tileSize: 16,
    tiles: [
      {
        id: id + "_floor",
        spriteId: "tile_" + offset,
        walkable: true,
        projectileBlocking: false,
        variants: [
          { spriteId: "tile_" + offset, weight: 1 },
          { spriteId: "tile_" + (offset + 1), weight: 1 },
        ],
      },
      {
        id: id + "_wall",
        spriteId: "tile_" + (offset + 4),
        walkable: false,
        projectileBlocking: true,
        variants: [],
      },
    ],
  });
  add("biomes", {
    ...base(id),
    paletteId: id + "_tiles",
    musicId: "frontier",
    background: bg,
  });
  add("generationRules", {
    ...base(id + "_rooms"),
    width: 48,
    height: 32,
    rooms: 9,
    minRoomSize: 6,
    maxRoomSize: 10,
    floorTileId: id + "_floor",
    wallTileId: id + "_wall",
    requiredRoomTemplateIds: [],
  });
}
add("enemySpawnTables", {
  ...base("frontier_enemies"),
  kind: "enemy",
  entries: ["beetle_enemy", "spore_enemy", "sentry_enemy"].map(
    (definitionId) => ({ definitionId, weight: 1, probability: 1 }),
  ),
  min: 5,
  max: 10,
  chance: 1,
  attempts: 500,
  minDistance: 80,
});
add("decorationSpawnTables", {
  ...base("frontier_props"),
  kind: "prop",
  entries: [{ definitionId: "supply_crate", weight: 1, probability: 1 }],
  min: 3,
  max: 7,
  chance: 1,
  attempts: 200,
  minDistance: 48,
});
add("chestSpawnTables", {
  ...base("frontier_chests"),
  kind: "chest",
  entries: [{ definitionId: "weapon_cache", weight: 1, probability: 1 }],
  min: 1,
  max: 2,
  chance: 1,
  attempts: 200,
  minDistance: 48,
});
for (const [id, biome, boss] of [
  ["green_edge", "overgrowth", false],
  ["rootways", "overgrowth", false],
  ["secret_cache", "overgrowth", false],
  ["rust_gate", "foundry", false],
  ["core_chamber", "foundry", true],
] as const)
  add("levels", {
    ...base(id),
    biomeId: biome,
    generationMode: "procedural",
    generationRuleId: biome + "_rooms",
    enemySpawnTableId: "frontier_enemies",
    decorationSpawnTableId: "frontier_props",
    chestSpawnTableId: "frontier_chests",
    difficultyBudget: boss ? 40 : 80,
    ...(boss ? { bossId: "furnace" } : {}),
  });
const cells = Array.from({ length: 20 }, (_, y) =>
  Array.from({ length: 28 }, (_, x) =>
    x === 0 || y === 0 || x === 27 || y === 19 ? "overgrowth_wall" : null,
  ),
);
add("tilemaps", {
  ...base("handmade_garden"),
  paletteId: "overgrowth_tiles",
  width: 28,
  height: 20,
  layers: [
    {
      id: "floor",
      cells: Array.from({ length: 20 }, () =>
        Array(28).fill("overgrowth_floor"),
      ),
    },
    { id: "wall_base", cells },
  ],
  placements: [
    { placementId: "start", kind: "player_spawn", position: { x: 56, y: 56 } },
    { placementId: "exit", kind: "level_exit", position: { x: 392, y: 264 } },
    {
      placementId: "crates",
      kind: "prop",
      definitionId: "supply_crate",
      position: { x: 200, y: 152 },
    },
  ],
  spawnZones: [],
});
add("campaigns", {
  ...base("emberfall", "Emberfall: The Last Furnace"),
  startNodeId: "edge",
  endless: false,
  maxRepeats: 0,
  nodes: [
    ["edge", "green_edge"],
    ["roots", "rootways"],
    ["secret", "secret_cache"],
    ["gate", "rust_gate"],
    ["core", "core_chamber"],
  ]
    .map(([nodeId, levelId]) => ({
      nodeId,
      kind: nodeId === "core" ? ("boss" as const) : ("level" as const),
      levelId,
      unlockRuleIds: [],
      difficultyScale: 1,
    }))
    .concat([
      {
        nodeId: "end",
        kind: "end" as never,
        levelId: undefined as never,
        unlockRuleIds: [],
        difficultyScale: 1,
      },
    ]),
  edges: [
    ["a", "edge", "roots"],
    ["b", "roots", "gate"],
    ["c", "roots", "secret"],
    ["d", "secret", "gate"],
    ["e", "gate", "core"],
    ["f", "core", "end"],
  ].map(([edgeId, fromNodeId, toNodeId]) => ({
    edgeId,
    fromNodeId,
    toNodeId,
    selection:
      fromNodeId === "roots"
        ? ("weighted_random" as const)
        : ("always" as const),
    weight: 1,
  })),
});
add("unlocks", {
  ...base("unlock_prism"),
  rewardCharacterId: "prism",
  mode: "any",
  progressScope: "account",
  participantRequirement: "participated",
  conditions: { type: "biome_completed", biomeId: "foundry" },
  permanent: true,
});
const clean = JSON.parse(JSON.stringify(content));
assertContent(clean);
for (const [key, path] of Object.entries(CONTENT_PATHS)) {
  const file = "content/base-game/" + path;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(clean[key as CollectionName], null, 2) + "\n",
  );
}
await mkdir("packages/content-schemas/json", { recursive: true });
for (const [key, schema] of Object.entries(collectionSchemas))
  await writeFile(
    `packages/content-schemas/json/${key}.schema.json`,
    JSON.stringify(schema, null, 2) + "\n",
  );
console.log(`Created ${Object.keys(content).length} validated collections.`);
