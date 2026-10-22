import {
  Type as T,
  type Static,
  type TSchema,
  type TProperties,
} from "@sinclair/typebox";
import { EVENT_FIELDS, STAT_NAMES } from "../../shared-types/src/index";
const o = <P extends TProperties>(p: P, extra = {}) =>
  T.Object(p, { additionalProperties: false, ...extra });
const s = T.String({ maxLength: 160 });
export const Id = T.String({ pattern: "^[a-z][a-z0-9_.-]{0,79}$" });
const n = (min = 0, max = 100000, def = 0) =>
  T.Number({ minimum: min, maximum: max, default: def });
const i = (min = 0, max = 100000, def = 0) =>
  T.Integer({ minimum: min, maximum: max, default: def });
const e = <V extends string>(...values: V[]) =>
  T.Union(values.map((v) => T.Literal(v)));
const a = <S extends TSchema>(schema: S, max = 2048) =>
  T.Array(schema, { maxItems: max });
const ref = (collection: string) =>
  T.String({ ...Id, "x-collection": collection });
const opt = T.Optional;
const point = o({ x: n(-100000, 100000), y: n(-100000, 100000) });
const range = o({ min: n(), max: n() });
const curve = a(o({ t: n(0, 1), value: n(-1000, 1000) }), 32);
const common = {
  id: Id,
  name: T.String({ minLength: 1, maxLength: 100 }),
  tags: a(s, 32),
};
const anim = o({
  idle: ref("animations"),
  run: opt(ref("animations")),
  hurt: opt(ref("animations")),
  death: opt(ref("animations")),
  victory: opt(ref("animations")),
  windup: opt(ref("animations")),
  attack: opt(ref("animations")),
  open: opt(ref("animations")),
});
const collider = T.Union([
  o({ shape: T.Literal("circle"), radius: n(1, 128, 10) }),
  o({ shape: T.Literal("box"), width: n(1, 256, 20), height: n(1, 256, 20) }),
]);
const event = e(
  ...(Object.keys(EVENT_FIELDS) as (keyof typeof EVENT_FIELDS)[]),
);
const condition = o({
  field: s,
  operator: e("eq", "neq", "gte", "lte", "in", "has_tag"),
  value: T.Union([s, T.Number(), T.Boolean(), a(s, 32)]),
});
const cosmetic = T.Union([
  o({ type: T.Literal("play_sfx"), soundId: ref("sounds") }),
  o({ type: T.Literal("spawn_particles"), particleEffectId: ref("particles") }),
  o({
    type: T.Literal("camera_effect"),
    cameraEffectId: ref("cameraEffects"),
    scope: e("local_actor", "nearby_players", "all_room"),
  }),
  o({ type: T.Literal("switch_music"), musicId: ref("music") }),
  o({ type: T.Literal("play_animation"), animationId: ref("animations") }),
]);
const combatAction = T.Union([
  o({ type: T.Literal("heal"), amount: n(0, 1000) }),
  o({
    type: T.Literal("damage"),
    amount: n(0, 1000),
    radius: n(0, 1000),
    damageTypeId: ref("damageTypes"),
  }),
  o({
    type: T.Literal("modify_stat"),
    stat: e(...STAT_NAMES),
    operation: e("add", "multiply"),
    value: n(-100, 100),
  }),
  o({
    type: T.Literal("apply_status"),
    statusId: ref("statuses"),
    durationTicks: i(1, 3600),
  }),
  o({
    type: T.Literal("spawn_projectile"),
    projectileId: ref("projectiles"),
    count: i(1, 32),
  }),
  o({ type: T.Literal("grant_ammo"), amount: i(1, 1000) }),
]);
const stats = o({
  maxHealth: n(1, 100000, 100),
  moveSpeed: n(1, 600, 120),
  armor: n(0, 1000),
  damageMultiplier: n(0.01, 100, 1),
  fireRateMultiplier: n(0.05, 20, 1),
  critChance: n(0, 1),
  pickupRadius: n(8, 200, 24),
});
const rewards = o({
  dropRuleId: ref("dropRules"),
  lootTableId: ref("lootTables"),
});
const spawnEntry = o({
  definitionId: Id,
  weight: n(0.001, 100000, 1),
  probability: n(0, 1, 1),
});
const spawnTable = o({
  ...common,
  kind: e("enemy", "prop", "chest"),
  entries: a(spawnEntry, 256),
  min: i(0, 200),
  max: i(0, 200, 8),
  chance: n(0, 1, 1),
  attempts: i(1, 1000, 100),
  minDistance: n(0, 1000, 64),
});
const unlockLeaf = T.Union([
  o({ type: T.Literal("level_completed"), levelId: ref("levels") }),
  o({ type: T.Literal("biome_completed"), biomeId: ref("biomes") }),
  o({ type: T.Literal("boss_defeated"), bossId: ref("bosses") }),
  o({ type: T.Literal("max_level_reached"), levelNumber: i(1, 10000) }),
]);
const unlockCondition = T.Union([
  unlockLeaf,
  o({ type: e("all_of", "any_of"), children: a(unlockLeaf, 32) }),
]);
export const definitions = {
  damageTypes: o({ ...common }),
  sprites: o({
    ...common,
    source: T.String({ pattern: "^assets/[a-zA-Z0-9_./-]+\\.(png|webp)$" }),
    frame: o({ x: i(), y: i(), width: i(1, 4096, 32), height: i(1, 4096, 32) }),
    pivot: point,
    renderScale: n(0.01, 16, 1),
    rotationOffsetDeg: n(-360, 360),
    layer: e("floor", "props", "characters", "vfx_front", "ui"),
  }),
  animations: o({
    ...common,
    loop: T.Boolean(),
    holdLastFrame: T.Boolean(),
    defaultFrameDurationMs: i(16, 5000, 100),
    direction: e("right", "left", "up", "down", "any"),
    frames: T.Array(
      o({
        spriteId: ref("sprites"),
        durationMs: i(16, 5000, 100),
        offset: point,
        events: a(cosmetic, 16),
      }),
      { minItems: 1, maxItems: 256 },
    ),
  }),
  characters: o({
    ...common,
    description: s,
    spriteId: ref("sprites"),
    animationSet: anim,
    collision: collider,
    stats,
    startingWeaponIds: T.Array(ref("weapons"), { minItems: 1, maxItems: 5 }),
    unlockRuleId: T.Union([ref("unlocks"), T.Null()]),
    facingMode: e("horizontal_flip", "directional"),
  }),
  projectiles: o({
    ...common,
    spriteId: ref("sprites"),
    speed: n(1, 3000, 400),
    acceleration: n(-2000, 2000),
    radius: n(0.5, 64, 3),
    damage: n(0, 10000, 10),
    damageTypeId: ref("damageTypes"),
    lifetimeTicks: i(1, 1800, 90),
    pierce: i(0, 100),
    ricochets: i(0, 20),
    explosionRadius: n(0, 500),
    gravity: point,
    drag: n(0, 10),
    homing: n(0, 10),
  }),
  beams: o({
    ...common,
    range: n(1, 2000, 300),
    width: n(1, 100, 4),
    damage: n(0, 10000, 8),
    damageTypeId: ref("damageTypes"),
    pierce: i(0, 100),
    color: T.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
    durationTicks: i(1, 300, 3),
  }),
  weapons: o({
    ...common,
    spriteId: ref("sprites"),
    class: e("melee", "bullet", "shotgun", "bolt", "laser"),
    cooldownTicks: i(1, 1800, 10),
    magazineSize: i(1, 1000, 12),
    reloadTicks: i(1, 1800, 30),
    ammoPerShot: i(0, 100, 1),
    spreadDeg: n(0, 180),
    pellets: i(1, 64, 1),
    projectileId: opt(ref("projectiles")),
    beamId: opt(ref("beams")),
    melee: opt(
      o({
        range: n(1, 300, 48),
        arcDeg: n(1, 360, 90),
        damage: n(1, 10000, 20),
        damageTypeId: ref("damageTypes"),
        knockback: n(0, 500),
      }),
    ),
  }),
  behaviors: o({
    ...common,
    mode: e("chase", "ranged", "orbit", "guard", "flee"),
    detectionRange: n(1, 2000, 500),
    preferredRange: n(0, 1500, 140),
    strafe: n(-1, 1),
    navigation: T.Boolean(),
  }),
  attackPatterns: o({
    ...common,
    weaponId: ref("weapons"),
    windupTicks: i(0, 1800, 12),
    recoveryTicks: i(1, 1800, 30),
    shots: i(1, 64, 1),
    spreadDeg: n(0, 360),
    aim: e("target", "radial", "sweep"),
    summonEnemyId: opt(ref("enemies")),
    summonCount: i(0, 20),
  }),
  enemies: o({
    ...common,
    spriteId: ref("sprites"),
    animationSet: anim,
    collision: collider,
    stats,
    behaviorId: ref("behaviors"),
    attackPatternIds: T.Array(ref("attackPatterns"), {
      minItems: 1,
      maxItems: 16,
    }),
    difficultyRating: n(1, 100, 10),
    contactDamage: n(0, 10000),
    xpReward: i(0, 10000, 5),
    rewards,
  }),
  bosses: o({
    ...common,
    spriteId: ref("sprites"),
    animationSet: anim,
    collision: collider,
    stats,
    difficultyRating: n(1, 100, 80),
    contactDamage: n(0, 10000),
    xpReward: i(0, 10000, 100),
    rewards,
    phases: T.Array(
      o({
        id: Id,
        minHealthRatio: n(0, 1),
        behaviorId: ref("behaviors"),
        attackPatternIds: T.Array(ref("attackPatterns"), {
          minItems: 1,
          maxItems: 16,
        }),
      }),
      { minItems: 1, maxItems: 12 },
    ),
  }),
  props: o({
    ...common,
    spriteId: ref("sprites"),
    destroyedSpriteId: opt(ref("sprites")),
    collision: collider,
    blocksMovement: T.Boolean(),
    blocksProjectiles: T.Boolean(),
    blocksLineOfSight: T.Boolean(),
    destructible: T.Boolean(),
    maxHealth: n(1, 100000, 25),
    resistances: T.Record(Id, n(0, 10)),
    rewards: opt(rewards),
  }),
  chests: o({
    ...common,
    spriteId: ref("sprites"),
    animationSet: anim,
    collision: collider,
    interaction: o({
      mode: e("interact", "damage", "proximity"),
      radius: n(1, 200, 40),
      openTicks: i(0, 1800, 10),
    }),
    rewards,
    policy: e("shared_world", "individual_instanced"),
  }),
  pickups: o({
    ...common,
    spriteId: ref("sprites"),
    kind: e("heal", "ammo", "xp"),
    amount: n(1, 10000, 20),
  }),
  lootTables: o({
    ...common,
    entries: T.Array(
      o({
        rewardType: e("pickup", "weapon", "mutation"),
        rewardId: Id,
        weight: n(0.001, 100000, 1),
        min: i(1, 100, 1),
        max: i(1, 100, 1),
      }),
      { minItems: 1, maxItems: 256 },
    ),
  }),
  dropRules: o({
    ...common,
    baseChance: n(0, 1, 0.25),
    slopePerPoint: n(-1, 1, 0.0125),
    baseline: n(0, 100, 1),
    minMultiplier: n(0, 10, 0.5),
    maxMultiplier: n(0, 10, 2.25),
    levelMultiplier: n(0, 10, 1),
    coopMultiplier: n(0, 10, 1),
    rollsMin: i(1, 100, 1),
    rollsMax: i(1, 100, 1),
    guaranteedDrop: T.Boolean(),
  }),
  statuses: o({
    ...common,
    durationTicks: i(1, 3600, 90),
    tickInterval: i(1, 3600, 30),
    damagePerTick: n(0, 1000),
    damageTypeId: ref("damageTypes"),
    speedMultiplier: n(0, 5, 1),
    stun: T.Boolean(),
  }),
  effects: o({
    ...common,
    mode: e("builtin", "graph", "custom_extension"),
    event,
    probability: n(0, 1, 1),
    cooldownTicks: i(0, 3600),
    conditions: a(condition, 32),
    actions: a(combatAction, 32),
    graphId: opt(ref("graphs")),
    extensionId: opt(Id),
    extensionVersion: opt(s),
    params: opt(T.Record(Id, T.Union([n(-10000, 10000), s, T.Boolean()]))),
  }),
  mutations: o({
    ...common,
    description: s,
    iconSpriteId: ref("sprites"),
    maxStacks: i(1, 10, 1),
    weight: n(0.01, 10000, 1),
    effectIds: T.Array(ref("effects"), { minItems: 1, maxItems: 16 }),
  }),
  graphs: o({
    ...common,
    event,
    nodes: T.Array(
      o({
        id: Id,
        type: e("event", "condition", "chance", "cooldown", "delay", "action"),
        condition: opt(condition),
        probability: opt(n(0, 1)),
        ticks: opt(i(0, 3600)),
        action: opt(combatAction),
      }),
      { minItems: 1, maxItems: 128 },
    ),
    edges: a(o({ from: Id, to: Id }), 256),
  }),
  sounds: o({
    ...common,
    source: T.String({ pattern: "^assets/[a-zA-Z0-9_./-]+\\.(wav|ogg|mp3)$" }),
    baseGain: n(0, 1, 0.8),
    pitch: range,
    loop: T.Boolean(),
    spatial: o({
      enabled: T.Boolean(),
      referenceDistance: n(1, 2000, 160),
      maxDistance: n(1, 5000, 900),
    }),
    cooldownMs: i(0, 10000, 40),
    maxConcurrent: i(1, 64, 8),
    priority: i(0, 100, 50),
  }),
  music: o({
    ...common,
    source: T.String({ pattern: "^assets/[a-zA-Z0-9_./-]+\\.(wav|ogg|mp3)$" }),
    baseGain: n(0, 1, 0.6),
    loop: T.Boolean(),
    loopStartMs: i(),
    loopEndMs: i(0, 3600000),
    fadeInMs: i(0, 30000, 800),
    fadeOutMs: i(0, 30000, 1000),
  }),
  particles: o({
    ...common,
    spriteId: ref("sprites"),
    emission: o({
      mode: e("burst", "continuous"),
      count: i(0, 1000, 16),
      ratePerSecond: n(0, 1000),
      durationMs: i(0, 60000, 500),
      maxAlive: i(1, 10000, 100),
      shape: e("point", "circle", "line", "rectangle"),
      shapeRadius: n(0, 500),
      directionDeg: n(-360, 360),
      spreadDeg: n(0, 360, 360),
    }),
    motion: o({
      speed: range,
      acceleration: point,
      gravity: point,
      dragPerSecond: n(0, 20),
      rotationDeg: range,
      angularVelocityDegPerSecond: o({
        min: n(-3600, 3600),
        max: n(-3600, 3600),
      }),
      alignToVelocity: T.Boolean(),
    }),
    lifetimeMs: range,
    sizeOverLife: curve,
    alphaOverLife: curve,
    collision: o({ mode: e("none", "bounce", "stop"), restitution: n(0, 1) }),
    color: T.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
    priority: i(0, 100, 50),
  }),
  cameraEffects: o({
    ...common,
    durationMs: i(1, 10000, 100),
    amplitudePx: n(0, 32, 3),
    frequencyHz: n(1, 120, 24),
    falloff: e("linear", "easeOut"),
    stacking: e("max", "replace", "add_capped"),
    maxDistance: n(1, 5000, 900),
  }),
  eventBindings: o({
    ...common,
    event,
    conditions: a(condition, 32),
    actions: T.Array(cosmetic, { minItems: 1, maxItems: 32 }),
    cooldownMs: i(0, 60000),
    probability: n(0, 1, 1),
    enabled: T.Boolean(),
  }),
  biomes: o({
    ...common,
    paletteId: ref("tilePalettes"),
    musicId: opt(ref("music")),
    background: T.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
  }),
  tilePalettes: o({
    ...common,
    tileSize: i(8, 64, 16),
    tiles: T.Array(
      o({
        id: Id,
        spriteId: ref("sprites"),
        walkable: T.Boolean(),
        projectileBlocking: T.Boolean(),
        variants: a(
          o({ spriteId: ref("sprites"), weight: n(0.001, 10000, 1) }),
          32,
        ),
        autotile: opt(
          T.Record(T.String({ pattern: "^([0-9]|1[0-5])$" }), ref("sprites")),
        ),
      }),
      { minItems: 1, maxItems: 512 },
    ),
  }),
  tilemaps: o({
    ...common,
    paletteId: ref("tilePalettes"),
    width: i(5, 128, 40),
    height: i(5, 128, 28),
    layers: T.Array(
      o({
        id: e("floor", "floor_details", "wall_base", "wall_top"),
        cells: a(a(T.Union([Id, T.Null()]), 128), 128),
      }),
      { minItems: 1, maxItems: 4 },
    ),
    placements: a(
      o({
        placementId: Id,
        kind: e("enemy", "boss", "prop", "chest", "player_spawn", "level_exit"),
        definitionId: opt(Id),
        position: point,
      }),
      500,
    ),
    spawnZones: a(
      o({
        id: Id,
        x: i(),
        y: i(),
        width: i(1, 128),
        height: i(1, 128),
        tableId: Id,
      }),
      64,
    ),
  }),
  roomTemplates: o({
    ...common,
    tilemapId: ref("tilemaps"),
    minDepth: i(1, 10000, 1),
    maxDepth: i(1, 10000, 10000),
  }),
  generationRules: o({
    ...common,
    width: i(16, 128, 48),
    height: i(16, 128, 32),
    rooms: i(2, 30, 8),
    minRoomSize: i(4, 20, 5),
    maxRoomSize: i(4, 30, 10),
    floorTileId: Id,
    wallTileId: Id,
    requiredRoomTemplateIds: a(ref("roomTemplates"), 16),
  }),
  enemySpawnTables: spawnTable,
  decorationSpawnTables: spawnTable,
  chestSpawnTables: spawnTable,
  levels: o({
    ...common,
    biomeId: ref("biomes"),
    generationMode: e("handcrafted", "procedural", "hybrid"),
    tilemapId: opt(ref("tilemaps")),
    generationRuleId: opt(ref("generationRules")),
    enemySpawnTableId: ref("enemySpawnTables"),
    decorationSpawnTableId: ref("decorationSpawnTables"),
    chestSpawnTableId: ref("chestSpawnTables"),
    bossId: opt(ref("bosses")),
    difficultyBudget: n(0, 10000, 50),
  }),
  campaigns: o({
    ...common,
    startNodeId: Id,
    endless: T.Boolean(),
    maxRepeats: i(0, 10000),
    nodes: T.Array(
      o({
        nodeId: Id,
        kind: e("level", "boss", "milestone", "end"),
        levelId: opt(ref("levels")),
        unlockRuleIds: a(ref("unlocks"), 32),
        difficultyScale: n(0.1, 20, 1),
      }),
      { minItems: 1, maxItems: 256 },
    ),
    edges: a(
      o({
        edgeId: Id,
        fromNodeId: Id,
        toNodeId: Id,
        selection: e("always", "weighted_random", "player_choice", "condition"),
        weight: n(0.001, 10000, 1),
        condition: opt(unlockLeaf),
      }),
      512,
    ),
  }),
  unlocks: o({
    ...common,
    rewardCharacterId: ref("characters"),
    mode: e("any", "solo", "coop"),
    progressScope: e("account", "single_run"),
    participantRequirement: e("participated", "alive"),
    conditions: unlockCondition,
    permanent: T.Boolean(),
  }),
} as const;
export type CollectionName = keyof typeof definitions;
export type Definition<K extends CollectionName> = Static<
  (typeof definitions)[K]
>;
export type Content = {
  [K in CollectionName]: { schemaVersion: "1.0.0"; items: Definition<K>[] };
};
export type AnyDefinition = Definition<CollectionName>;
export const collectionSchemas = Object.fromEntries(
  Object.entries(definitions).map(([k, v]) => [
    k,
    o(
      { schemaVersion: T.Literal("1.0.0"), items: a(v, 10000) },
      {
        $id: `https://emberfall.local/schema/${k}`,
        $schema: "https://json-schema.org/draft/2020-12/schema",
      },
    ),
  ]),
) as unknown as Record<CollectionName, TSchema>;
export const CONTENT_PATHS: Record<CollectionName, string> = {
  damageTypes: "combat/damage-types.json",
  sprites: "visuals/sprites.json",
  animations: "visuals/animations.json",
  characters: "entities/characters.json",
  projectiles: "combat/projectiles.json",
  beams: "combat/beams.json",
  weapons: "combat/weapons.json",
  behaviors: "ai/behaviors.json",
  attackPatterns: "combat/attack-patterns.json",
  enemies: "entities/enemies.json",
  bosses: "entities/bosses.json",
  props: "entities/props.json",
  chests: "world/chests.json",
  pickups: "world/pickups.json",
  lootTables: "world/loot-tables.json",
  dropRules: "world/drop-rules.json",
  statuses: "effects/statuses.json",
  effects: "effects/effect-definitions.json",
  mutations: "effects/mutations.json",
  graphs: "effects/graphs.json",
  sounds: "audio/sounds.json",
  music: "audio/music.json",
  particles: "visuals/particles.json",
  cameraEffects: "visuals/camera-effects.json",
  eventBindings: "triggers/event-bindings.json",
  biomes: "world/biomes.json",
  tilePalettes: "world/tile-palettes.json",
  tilemaps: "world/tilemaps.json",
  roomTemplates: "world/room-templates.json",
  generationRules: "world/generation-rules.json",
  enemySpawnTables: "world/enemy-spawn-tables.json",
  decorationSpawnTables: "world/decoration-spawn-tables.json",
  chestSpawnTables: "world/chest-spawn-tables.json",
  levels: "world/levels.json",
  campaigns: "world/level-sequences.json",
  unlocks: "world/unlock-rules.json",
};
