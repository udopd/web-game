import type { GameEvent } from "../../shared-types/src/index";
import type { Definition } from "../../content-schemas/src/definitions";
export type EffectAction = Definition<"effects">["actions"][number];
export function conditionMatches(
  condition: Definition<"effects">["conditions"][number],
  event: GameEvent,
) {
  const value = event.payload[condition.field];
  switch (condition.operator) {
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "gte":
      return (
        typeof value === "number" &&
        typeof condition.value === "number" &&
        value >= condition.value
      );
    case "lte":
      return (
        typeof value === "number" &&
        typeof condition.value === "number" &&
        value <= condition.value
      );
    case "in":
      return (
        Array.isArray(condition.value) &&
        condition.value.includes(String(value))
      );
    case "has_tag":
      return (
        typeof value === "string" &&
        value.split(",").includes(String(condition.value))
      );
  }
}
export type GraphContext = {
  tick: number;
  random: () => number;
  state: Record<string, string | number | boolean>;
  action: (action: EffectAction) => void;
  delay: (nodeId: string, ticks: number) => void;
};
export function executeGraph(
  graph: Definition<"graphs">,
  event: GameEvent,
  ctx: GraphContext,
  start?: string,
) {
  const queue = [start ?? graph.nodes.find((n) => n.type === "event")!.id],
    trace: { nodeId: string; passed: boolean; reason: string }[] = [];
  let operations = 0;
  while (queue.length && operations++ < 128) {
    const id = queue.shift()!,
      node = graph.nodes.find((n) => n.id === id);
    if (!node) throw new Error("Graph node missing");
    let passed = true;
    let reason: string = node.type;
    if (node.type === "condition") {
      passed = conditionMatches(node.condition!, event);
      reason = passed ? "condition pass" : "condition fail";
    }
    if (node.type === "chance") {
      passed = ctx.random() < (node.probability ?? 1);
      reason = passed ? "chance pass" : "chance fail";
    }
    if (node.type === "cooldown") {
      const ready = Number(ctx.state[id] ?? 0);
      passed = ctx.tick >= ready;
      if (passed) ctx.state[id] = ctx.tick + (node.ticks ?? 0);
      reason = passed ? "cooldown ready" : "cooldown active";
    }
    if (node.type === "action") ctx.action(node.action!);
    const next = graph.edges
      .filter((e) => e.from === id)
      .map((e) => e.to)
      .sort();
    if (passed) {
      if (node.type === "delay") {
        for (const child of next) ctx.delay(child, node.ticks ?? 1);
      } else queue.push(...next);
    }
    trace.push({ nodeId: id, passed, reason });
  }
  if (queue.length) throw new Error("Graph exceeded execution budget");
  return trace;
}
