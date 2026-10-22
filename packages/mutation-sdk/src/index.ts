import type { EventName, GameEvent, Vec2 } from "../../shared-types/src/index";
export type EntityView = Readonly<
  Vec2 & { id: string; team: string; alive: boolean }
>;
export interface MutationContext {
  readonly ownerId: string;
  readonly tick: number;
  readonly tickRate: number;
  owner(): EntityView | null;
  getEntity(id: string): EntityView | null;
  entitiesInRadius(centerId: string, radius: number): readonly EntityView[];
  isEnemyOf(targetId: string, sourceId: string): boolean;
  random01(): number;
  emitDamage(command: {
    sourceId: string;
    targetId: string;
    amount: number;
    damageTypeId: string;
    originExtensionId: string;
    procChainId: string;
  }): void;
  emitVfx(command: { effectId: string; entityIds: readonly string[] }): void;
}
export interface MutationExtension<
  P extends object = Record<string, string | number | boolean>,
  S extends object = Record<string, string | number | boolean>,
> {
  readonly id: string;
  readonly version: string;
  readonly subscribedEvents: readonly EventName[];
  initialState(): S;
  onEvent(ctx: MutationContext, event: GameEvent, params: P, state: S): S;
}
