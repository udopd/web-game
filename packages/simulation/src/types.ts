import type {
  InputCommand,
  GameEvent,
  Vec2,
} from "../../shared-types/src/index";
import type { WorldMap } from "../../procedural-generation/src/index";
export type Actor = {
  id: string;
  definitionId: string;
  kind: "player" | "enemy" | "boss";
  team: "players" | "enemies";
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  damageMultiplier: number;
  fireRateMultiplier: number;
  critChance: number;
  pickupRadius: number;
  aim: number;
  state: "idle" | "run" | "hurt" | "death" | "victory" | "windup";
  stateTick: number;
  weaponIds: string[];
  weaponSlot: number;
  ammo: Record<string, number>;
  reserve: number;
  readyTick: number;
  reloadTick: number;
  attackTick: number;
  attackPatternId: string;
  phaseId: string;
  xp: number;
  level: number;
  kills: number;
  mutations: string[];
  mutationChoices: string[];
  statuses: { id: string; until: number; nextTick: number; ownerId: string }[];
  input: InputCommand;
  lastInputTick: number;
  effectState: Record<string, Record<string, string | number | boolean>>;
  path: Vec2[];
};
export type Projectile = {
  id: string;
  definitionId: string;
  ownerId: string;
  team: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  expires: number;
  pierce: number;
  ricochets: number;
  hitIds: string[];
  origin: GameEvent["origin"];
};
export type PropState = {
  id: string;
  definitionId: string;
  x: number;
  y: number;
  hp: number;
  destroyed: boolean;
};
export type ChestState = {
  id: string;
  definitionId: string;
  x: number;
  y: number;
  state: "closed" | "opening" | "opened";
  openTick: number;
  openerId: string;
  claimedBy: string[];
};
export type PickupState = {
  id: string;
  kind: "pickup" | "weapon" | "mutation";
  definitionId: string;
  x: number;
  y: number;
  ownerId?: string;
};
export type BeamState = {
  id: string;
  from: Vec2;
  to: Vec2;
  width: number;
  color: string;
  expires: number;
};
export type ProgressFacts = {
  levels: string[];
  biomes: string[];
  bosses: string[];
  maxDepth: number;
};
export type WorldState = {
  schemaVersion: "1.0.0";
  engineVersion: string;
  contentVersion: string;
  runId: string;
  seed: number;
  tick: number;
  sequence: number;
  entitySequence: number;
  random: { combat: number; loot: number };
  campaignId: string;
  nodeId: string;
  levelId: string;
  depth: number;
  status: "running" | "defeat" | "victory";
  map: WorldMap;
  actors: Actor[];
  projectiles: Projectile[];
  props: PropState[];
  chests: ChestState[];
  pickups: PickupState[];
  beams: BeamState[];
  events: GameEvent[];
  progress: ProgressFacts;
  completed: boolean;
  repeatCount: number;
  delayed: {
    tick: number;
    ownerId: string;
    effectId: string;
    nodeId: string;
    event: GameEvent;
  }[];
};
export const neutralInput = (): InputCommand => ({
  seq: -1,
  moveX: 0,
  moveY: 0,
  aim: 0,
  fire: false,
  interact: false,
  weaponSlot: 0,
});
