export const SCHEMA_VERSION = "1.0.0" as const;
export const ENGINE_VERSION = "1.0.0" as const;
export const TICK_RATE = 30;
export const EVENT_FIELDS = {
  "run.started": ["campaignId"],
  "run.completed": ["campaignId"],
  "level.started": ["levelId", "biomeId"],
  "level.completed": ["levelId", "biomeId", "depth"],
  "biome.completed": ["biomeId"],
  "weapon.fired": ["weaponId"],
  "weapon.reloaded": ["weaponId"],
  "projectile.spawned": ["projectileId", "weaponId"],
  "projectile.hit": ["projectileId", "targetId"],
  "beam.hit": ["weaponId", "targetId"],
  "melee.hit": ["weaponId", "targetId"],
  "entity.damaged": ["targetId", "amount", "damageTypeId"],
  "entity.killed": ["targetId", "definitionId"],
  "entity.healed": ["targetId", "amount"],
  "enemy.killed": ["enemyId"],
  "boss.killed": ["bossId"],
  "enemy.attack_windup_started": ["enemyId", "executeTick"],
  "enemy.attack_executed": ["enemyId"],
  "enemy.attack_cancelled": ["enemyId"],
  "boss.phase_changed": ["bossId", "phaseId"],
  "boss.attack_windup_started": ["bossId", "executeTick"],
  "boss.attack_executed": ["bossId"],
  "boss.attack_cancelled": ["bossId"],
  "chest.open_started": ["chestId"],
  "chest.opened": ["chestId"],
  "prop.destroyed": ["propId"],
  "loot.spawned": ["itemId"],
  "loot.picked_up": ["itemId"],
  "mutation.activated": ["mutationId"],
  "status.applied": ["statusId", "targetId"],
  "player.death": ["characterId"],
  "player.victory": ["characterId"],
  "character.unlocked": ["characterId"],
  "tick.elapsed": [],
  "animation.event": ["animationId"],
  "ui.clicked": [],
} as const;
export type EventName = keyof typeof EVENT_FIELDS;
export type Vec2 = { x: number; y: number };
export type GameEvent = {
  eventId: string;
  type: EventName;
  tick: number;
  actorId: string;
  targetId?: string;
  position: Vec2;
  payload: Record<string, string | number | boolean>;
  origin: {
    kind: "weapon" | "mutation" | "environment";
    id: string;
    depth: number;
  };
};
export const STAT_NAMES = [
  "maxHealth",
  "moveSpeed",
  "damageMultiplier",
  "fireRateMultiplier",
  "armor",
  "critChance",
  "pickupRadius",
] as const;
export type StatName = (typeof STAT_NAMES)[number];
export type InputCommand = {
  seq: number;
  moveX: number;
  moveY: number;
  aim: number;
  fire: boolean;
  interact: boolean;
  weaponSlot: number;
  mutationId?: string;
  exitNodeId?: string;
};
export type UserSettings = {
  sfxVolume: number;
  musicVolume: number;
  muteSfx: boolean;
  muteMusic: boolean;
  screenShakeStrength: number;
  reducedMotion: "auto" | "on" | "off";
  particleQuality: "low" | "medium" | "high";
  controls: Record<"up" | "down" | "left" | "right" | "interact", string>;
};
export const DEFAULT_SETTINGS: UserSettings = {
  sfxVolume: 80,
  musicVolume: 60,
  muteSfx: false,
  muteMusic: false,
  screenShakeStrength: 50,
  reducedMotion: "auto",
  particleQuality: "high",
  controls: {
    up: "KeyW",
    down: "KeyS",
    left: "KeyA",
    right: "KeyD",
    interact: "KeyE",
  },
};
