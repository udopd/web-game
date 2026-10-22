import type { MutationExtension } from "../../../mutation-sdk/src/index";
type Params = {
  radius: number;
  maxJumps: number;
  damage: number;
  cooldownTicks: number;
  damageTypeId: string;
  vfxId: string;
};
type State = { nextReadyTick: number };
export const handler: MutationExtension<Params, State> = {
  id: "ext.chain_lightning",
  version: "1.0.0",
  subscribedEvents: ["entity.killed"],
  initialState: () => ({ nextReadyTick: 0 }),
  onEvent(ctx, event, p, state) {
    if (
      event.actorId !== ctx.ownerId ||
      ctx.tick < state.nextReadyTick ||
      event.origin.kind === "mutation" ||
      !event.targetId
    )
      return state;
    const visited = new Set([event.targetId]),
      affected: string[] = [];
    let sourceId = event.targetId;
    for (let j = 0; j < p.maxJumps; j++) {
      const source = ctx.getEntity(sourceId);
      if (!source) break;
      const targets = ctx
        .entitiesInRadius(sourceId, p.radius)
        .filter(
          (e) =>
            e.alive && ctx.isEnemyOf(e.id, ctx.ownerId) && !visited.has(e.id),
        )
        .sort(
          (a, b) =>
            (a.x - source.x) ** 2 +
              (a.y - source.y) ** 2 -
              ((b.x - source.x) ** 2 + (b.y - source.y) ** 2) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      const next = targets[0];
      if (!next) break;
      ctx.emitDamage({
        sourceId: ctx.ownerId,
        targetId: next.id,
        amount: p.damage,
        damageTypeId: p.damageTypeId,
        originExtensionId: "ext.chain_lightning",
        procChainId: event.eventId,
      });
      visited.add(next.id);
      affected.push(next.id);
      sourceId = next.id;
    }
    if (affected.length)
      ctx.emitVfx({ effectId: p.vfxId, entityIds: affected });
    return affected.length
      ? { nextReadyTick: ctx.tick + p.cooldownTicks }
      : state;
  },
};
