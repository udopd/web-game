import { expect, it } from "vitest";
import { arena, content } from "../fixtures";
import { ContentRegistry } from "../../packages/content-loader/src/registry";
import { Simulation } from "../../packages/simulation/src/simulation";

it("XP pickups cross the level threshold and offer a mutation exactly once", () => {
  const data = structuredClone(content);
  data.pickups.items.push({ id: "xp_orb", name: "XP", tags: [], spriteId: data.sprites.items[0].id, kind: "xp", amount: 10 });
  const state = arena().snapshot();
  state.actors[0].xp = 20;
  state.pickups.push({ id: "orb", kind: "pickup", definitionId: "xp_orb", x: 100, y: 100 });
  const simulation = new Simulation(new ContentRegistry(data, "test"), state);
  simulation.step();
  const player = simulation.state.actors[0];
  expect(player.level).toBe(2);
  expect(player.xp).toBe(5);
  expect(player.mutationChoices).toHaveLength(3);
  expect(simulation.state.pickups).toHaveLength(0);
  simulation.step();
  expect(player.level).toBe(2);
  expect(player.xp).toBe(5);
});
