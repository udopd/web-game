import { loadContent } from "../scripts/load-content";
import { ContentRegistry } from "../packages/content-loader/src/registry";
import { Simulation } from "../packages/simulation/src/simulation";
export const content = await loadContent();
export const registry = new ContentRegistry(content, "test");
export function simulation(seed = 42, players = 1) {
  return new Simulation(registry, {
    runId: "test-run",
    seed,
    campaignId: content.campaigns.items[0].id,
    players: Array.from({ length: players }, (_, i) => ({
      id: `player-${i}`,
      characterId: content.characters.items[0].id,
    })),
  });
}
/** An open combat arena with the real content definitions, without random placement interference. */
export function arena() {
  const sim = simulation();
  sim.state.map = {
    width: 30,
    height: 20,
    tileSize: 16,
    tiles: Array(600).fill("floor"),
    solid: Array(600).fill(false),
    projectileBlocking: Array(600).fill(false),
    spawn: { x: 100, y: 100 },
    exit: { x: 400, y: 200 },
    placements: [],
    biomeId: content.biomes.items[0].id,
  };
  sim.state.props = [];
  sim.state.chests = [];
  sim.state.pickups = [];
  sim.state.actors = sim.state.actors.slice(0, 1);
  sim.state.actors[0].x = 100;
  sim.state.actors[0].y = 100;
  sim.state.actors[0].critChance = 0;
  return sim;
}
export function target(sim: Simulation, x = 160, y = 100) {
  const source = simulation(43).state.actors.find((a) => a.kind === "enemy")!;
  const actor = structuredClone(source);
  actor.id = `target-${sim.state.actors.length}`;
  actor.x = x;
  actor.y = y;
  actor.hp = 100;
  actor.maxHp = 100;
  actor.armor = 0;
  actor.speed = 0;
  actor.readyTick = 1e9;
  actor.attackTick = 0;
  sim.state.actors.push(actor);
  return actor;
}
