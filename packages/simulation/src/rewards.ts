import { Rng, clamp } from "../../game-core/src/math";
import type { ContentRegistry } from "../../content-loader/src/registry";
import type { Definition } from "../../content-schemas/src/definitions";
import type { ProgressFacts } from "./types";
export function dropChance(
  rule: Definition<"dropRules">,
  rating: number,
  depth: number,
  coop: boolean,
) {
  return rule.guaranteedDrop
    ? 1
    : clamp(
        rule.baseChance *
          clamp(
            1 + (rating - rule.baseline) * rule.slopePerPoint,
            rule.minMultiplier,
            rule.maxMultiplier,
          ) *
          rule.levelMultiplier ** Math.max(0, depth - 1) *
          (coop ? rule.coopMultiplier : 1),
        0,
        1,
      );
}
export function resolveDrops(
  registry: ContentRegistry,
  ruleId: string,
  tableId: string,
  rating: number,
  depth: number,
  coop: boolean,
  rng: Rng,
) {
  const rule = registry.get("dropRules", ruleId);
  if (rng.next() >= dropChance(rule, rating, depth, coop)) return [];
  const table = registry.get("lootTables", tableId);
  const result: {
    kind: "pickup" | "weapon" | "mutation";
    definitionId: string;
  }[] = [];
  for (let r = 0, end = rng.int(rule.rollsMin, rule.rollsMax); r < end; r++) {
    const entry = rng.weighted(table.entries, (e) => e.weight);
    for (let i = 0, count = rng.int(entry.min, entry.max); i < count; i++)
      result.push({ kind: entry.rewardType, definitionId: entry.rewardId });
  }
  return result;
}
export function evaluateCondition(
  condition: Definition<"unlocks">["conditions"],
  facts: ProgressFacts,
): boolean {
  switch (condition.type) {
    case "all_of":
      return condition.children.every((c) => evaluateCondition(c, facts));
    case "any_of":
      return condition.children.some((c) => evaluateCondition(c, facts));
    case "level_completed":
      return facts.levels.includes(condition.levelId);
    case "biome_completed":
      return facts.biomes.includes(condition.biomeId);
    case "boss_defeated":
      return facts.bosses.includes(condition.bossId);
    case "max_level_reached":
      return facts.maxDepth >= condition.levelNumber;
  }
}
export function mergeFacts(a: ProgressFacts, b: ProgressFacts): ProgressFacts {
  return {
    levels: [...new Set([...a.levels, ...b.levels])],
    biomes: [...new Set([...a.biomes, ...b.biomes])],
    bosses: [...new Set([...a.bosses, ...b.bosses])],
    maxDepth: Math.max(a.maxDepth, b.maxDepth),
  };
}
