import { Type as T, type Static } from "@sinclair/typebox";
const object = <P extends import("@sinclair/typebox").TProperties>(p: P) =>
  T.Object(p, { additionalProperties: false });
export const InputSchema = object({
  seq: T.Integer({ minimum: 0, maximum: 2147483647 }),
  moveX: T.Number({ minimum: -1, maximum: 1 }),
  moveY: T.Number({ minimum: -1, maximum: 1 }),
  aim: T.Number({ minimum: -Math.PI * 2, maximum: Math.PI * 2 }),
  fire: T.Boolean(),
  interact: T.Boolean(),
  weaponSlot: T.Integer({ minimum: 0, maximum: 4 }),
  mutationId: T.Optional(T.String({ maxLength: 80 })),
  exitNodeId: T.Optional(T.String({ maxLength: 80 })),
});
export const ClientMessageSchema = object({
  type: T.Literal("input"),
  input: InputSchema,
});
export type ClientMessage = Static<typeof ClientMessageSchema>;
export type RoomMember = {
  uid: string;
  name: string;
  characterId: string;
  ready: boolean;
  connected: boolean;
};
export type RoomView = {
  id: string;
  ownerId: string;
  members: RoomMember[];
  status: "lobby" | "running" | "victory" | "defeat" | "closed";
  campaignId: string;
  contentVersion: string;
  runId: string | null;
};
