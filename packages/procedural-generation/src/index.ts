import { ContentRegistry } from "../../content-loader/src/registry";
import { Rng, distanceSq } from "../../game-core/src/math";
import type { Vec2 } from "../../shared-types/src/index";
import type { Definition } from "../../content-schemas/src/definitions";
import { tileAppearance } from "./tile-appearance";
export type Placement = {
  id: string;
  kind: "enemy" | "boss" | "prop" | "chest";
  definitionId: string;
  position: Vec2;
};
export type WorldMap = {
  width: number;
  height: number;
  tileSize: number;
  tiles: string[];
  tileSprites?: (string | null)[];
  solid: boolean[];
  projectileBlocking: boolean[];
  spawn: Vec2;
  exit: Vec2;
  placements: Placement[];
  biomeId: string;
};
export function generateLevel(
  registry: ContentRegistry,
  levelId: string,
  seed: number,
  options: { depth?: number; difficultyScale?: number } = {},
): WorldMap {
  const level = registry.get("levels", levelId),
    biome = registry.get("biomes", level.biomeId),
    palette = registry.get("tilePalettes", biome.paletteId),
    rng = new Rng(seed);
  const depth = options.depth ?? 1;
  const scale = Math.max(.1, Math.min(20, options.difficultyScale ?? 1));
  const zones: Definition<'tilemaps'>['spawnZones'] = [];
  let width = 0,
    height = 0,
    tiles: string[] = [],
    placements: Placement[] = [],
    spawn = { x: 0, y: 0 },
    exit = { x: 0, y: 0 };
  const size = palette.tileSize;
  let solid: boolean[] = [],
    projectileBlocking: boolean[] = [];
  if (level.generationMode === "handcrafted") {
    const map = registry.get("tilemaps", level.tilemapId!);
    width = map.width;
    height = map.height;
    zones.push(...map.spawnZones.map(zone => ({...zone})));
    const tileDefs = new Map(palette.tiles.map((x) => [x.id, x]));
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let tile = palette.tiles[0].id,
          blocked = false,
          bulletBlocked = false;
        for (const layer of map.layers) {
          const id = layer.cells[y][x];
          if (id) {
            tile = id;
            blocked ||= !tileDefs.get(id)!.walkable;
            bulletBlocked ||= tileDefs.get(id)!.projectileBlocking;
          }
        }
        tiles.push(tile);
        solid.push(blocked);
        projectileBlocking.push(bulletBlocked);
      }
    for (const p of map.placements) {
      if (p.kind === "player_spawn") spawn = { ...p.position };
      else if (p.kind === "level_exit") exit = { ...p.position };
      else
        placements.push({
          id: p.placementId,
          kind: p.kind,
          definitionId: p.definitionId!,
          position: { ...p.position },
        });
    }
  } else {
    const rule = registry.get("generationRules", level.generationRuleId!);
    width = rule.width;
    height = rule.height;
    tiles = Array(width * height).fill(rule.wallTileId);
    const centers: Vec2[] = [];
    const carve = (x: number, y: number) => {
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1)
        tiles[y * width + x] = rule.floorTileId;
    };
    for (let index = 0; index < rule.rooms; index++) {
      const w = rng.int(rule.minRoomSize, rule.maxRoomSize),
        h = rng.int(rule.minRoomSize, rule.maxRoomSize),
        x = rng.int(1, width - w - 1),
        y = rng.int(1, height - h - 1);
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) carve(xx, yy);
      const center = { x: Math.floor(x + w / 2), y: Math.floor(y + h / 2) };
      const prev = centers.at(-1);
      if (prev) {
        for (
          let xx = Math.min(prev.x, center.x);
          xx <= Math.max(prev.x, center.x);
          xx++
        )
          for (let d = -1; d <= 1; d++) carve(xx, prev.y + d);
        for (
          let yy = Math.min(prev.y, center.y);
          yy <= Math.max(prev.y, center.y);
          yy++
        )
          for (let d = -1; d <= 1; d++) carve(center.x + d, yy);
      }
      centers.push(center);
    }
    spawn = { x: (centers[0].x + 0.5) * size, y: (centers[0].y + 0.5) * size };
    exit = {
      x: (centers.at(-1)!.x + 0.5) * size,
      y: (centers.at(-1)!.y + 0.5) * size,
    };
    if (level.generationMode === "hybrid")
      for (const [index, id] of rule.requiredRoomTemplateIds.entries()) {
        const template = registry.get("roomTemplates", id);
        if (depth < template.minDepth || depth > template.maxDepth) continue;
        const
          map = registry.get("tilemaps", template.tilemapId),
          center = centers[Math.min(index, centers.length - 1)];
        const ox = Math.max(
            1,
            Math.min(
              width - map.width - 1,
              center.x - Math.floor(map.width / 2),
            ),
          ),
          oy = Math.max(
            1,
            Math.min(
              height - map.height - 1,
              center.y - Math.floor(map.height / 2),
            ),
          );
        zones.push(...map.spawnZones.map(zone => ({...zone,id:`template-${index}-${zone.id}`,x:zone.x+ox,y:zone.y+oy})));
        for (const layer of map.layers)
          for (let y = 0; y < map.height; y++)
            for (let x = 0; x < map.width; x++) {
              const tile = layer.cells[y][x];
              if (tile) tiles[(oy + y) * width + ox + x] = tile;
            }
        for (const p of map.placements) {
          const position = {
            x: ox * size + p.position.x,
            y: oy * size + p.position.y,
          };
          if (p.kind === "player_spawn") spawn = position;
          else if (p.kind === "level_exit") exit = position;
          else
            placements.push({
              id: `template-${index}-${p.placementId}`,
              kind: p.kind,
              definitionId: p.definitionId!,
              position,
            });
        }
      }
    const defs = new Map(palette.tiles.map((x) => [x.id, x]));
    solid = tiles.map((id) => !defs.get(id)!.walkable);
    projectileBlocking = tiles.map((id) => defs.get(id)!.projectileBlocking);
  }
  const map: WorldMap = {
    width,
    height,
    tileSize: size,
    tiles,
    solid,
    projectileBlocking,
    spawn,
    exit,
    placements,
    biomeId: biome.id,
  };
  // Deterministically connect start to exit after hybrid inserts.
  if (!reachable(map, spawn, exit)) {
    const floor = palette.tiles.find((t) => t.walkable)!.id;
    let x = Math.floor(spawn.x / size),
      y = Math.floor(spawn.y / size);
    const tx = Math.floor(exit.x / size),
      ty = Math.floor(exit.y / size);
    while (x !== tx || y !== ty) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx > 0 && yy > 0 && xx < width - 1 && yy < height - 1) {
            const k = yy * width + xx;
            tiles[k] = floor;
            solid[k] = false;
            projectileBlocking[k] = false;
          }
        }
      if (x !== tx) x += Math.sign(tx - x);
      else y += Math.sign(ty - y);
    }
  }
  const free = (p: Vec2, r: number) =>
    !circleBlocked(map, p, r) &&
    distanceSq(p, spawn) > 64 ** 2 &&
    distanceSq(p, exit) > 32 ** 2 &&
    placements.every((e) => distanceSq(e.position, p) > (r + 20) ** 2);
  const tables = [
    ["enemySpawnTables", level.enemySpawnTableId],
    ["decorationSpawnTables", level.decorationSpawnTableId],
    ["chestSpawnTables", level.chestSpawnTableId],
  ] as const;
  const jobs: {table:Definition<'enemySpawnTables'>; zone?:Definition<'tilemaps'>['spawnZones'][number]}[] =
    level.generationMode === 'handcrafted' ? [] : tables.map(([collection,id])=>({table:registry.get(collection,id)}));
  for (const zone of zones) {
    const candidates = tables.flatMap(([collection])=>registry.all(collection)).filter(table=>table.id===zone.tableId);
    if(candidates.length!==1)throw new Error(`Unknown or ambiguous spawn table ${zone.tableId}`);
    jobs.push({table:candidates[0],zone});
  }
  let budget = level.difficultyBudget * scale;
  for (const [jobIndex,{table,zone}] of jobs.entries()) {
    if (rng.next() > table.chance || !table.entries.length) continue;
    const target = Math.min(500, Math.round(rng.int(table.min, table.max) * (table.kind==='enemy'?scale:1)));
    let count = 0;
    for (
      let attempt = 0;
      attempt < table.attempts && count < target && placements.length < 500;
      attempt++
    ) {
      const entry = rng.weighted(table.entries, (x) => x.weight);
      if (rng.next() > entry.probability) continue;
      const p = {
        x: (rng.int(zone?.x ?? 1, zone ? zone.x+zone.width-1 : width - 2) + 0.5) * size,
        y: (rng.int(zone?.y ?? 1, zone ? zone.y+zone.height-1 : height - 2) + 0.5) * size,
      };
      if (distanceSq(p, spawn) < table.minDistance ** 2) continue;
      const def =
        table.kind === "enemy"
          ? registry.get("enemies", entry.definitionId)
          : table.kind === "prop"
            ? registry.get("props", entry.definitionId)
            : registry.get("chests", entry.definitionId);
      const radius =
        def.collision.shape === "circle"
          ? def.collision.radius
          : Math.max(def.collision.width, def.collision.height) / 2;
      if (!free(p, radius)) continue;
      if(!reachable(map,spawn,p))continue;
      if (table.kind === "enemy") {
        const cost = registry.get(
          "enemies",
          entry.definitionId,
        ).difficultyRating;
        if (cost > budget) continue;
        budget -= cost;
      }
      if (
        table.kind === "prop" &&
        registry.get("props", entry.definitionId).blocksMovement
      ) {
        const cell = Math.floor(p.y / size) * width + Math.floor(p.x / size);
        const prev = solid[cell];
        solid[cell] = true;
        const ok = reachable(map, spawn, exit);
        solid[cell] = prev;
        if (!ok) continue;
      }
      placements.push({
        id: `spawn-${jobIndex}-${table.kind}-${count}`,
        kind: table.kind,
        definitionId: entry.definitionId,
        position: p,
      });
      count++;
    }
  }
  if (level.bossId) {
    const boss = registry.get("bosses", level.bossId),
      radius =
        boss.collision.shape === "circle"
          ? boss.collision.radius
          : Math.max(boss.collision.width, boss.collision.height) / 2;
    const cells = tiles
      .map((_, k) => ({
        x: ((k % width) + 0.5) * size,
        y: (Math.floor(k / width) + 0.5) * size,
      }))
      .filter((p) => free(p, radius))
      .sort((a, b) => distanceSq(b, spawn) - distanceSq(a, spawn));
    if (!cells[0]) throw new Error(`Boss does not fit ${levelId}`);
    placements.push({
      id: "boss",
      kind: "boss",
      definitionId: boss.id,
      position: cells[0],
    });
  }
  map.tileSprites = tileAppearance(palette, tiles, width, height, seed ^ 0x1f123bb5);
  return map;
}
export function cellBlocked(
  map: WorldMap,
  x: number,
  y: number,
  projectile = false,
) {
  return (
    x < 0 ||
    y < 0 ||
    x >= map.width ||
    y >= map.height ||
    (projectile ? map.projectileBlocking : map.solid)[y * map.width + x]
  );
}
export function circleBlocked(
  map: WorldMap,
  p: Vec2,
  r: number,
  projectile = false,
) {
  for (
    let y = Math.floor((p.y - r) / map.tileSize);
    y <= Math.floor((p.y + r) / map.tileSize);
    y++
  )
    for (
      let x = Math.floor((p.x - r) / map.tileSize);
      x <= Math.floor((p.x + r) / map.tileSize);
      x++
    )
      if (cellBlocked(map, x, y, projectile)) {
        const nx = Math.max(
            x * map.tileSize,
            Math.min(p.x, (x + 1) * map.tileSize),
          ),
          ny = Math.max(
            y * map.tileSize,
            Math.min(p.y, (y + 1) * map.tileSize),
          );
        if ((p.x - nx) ** 2 + (p.y - ny) ** 2 < r * r) return true;
      }
  return false;
}
export function reachable(map: WorldMap, from: Vec2, to: Vec2) {
  return pathTo(map, from, to).length > 0;
}
export function pathTo(map: WorldMap, from: Vec2, to: Vec2): Vec2[] {
  const sx = Math.floor(from.x / map.tileSize),
    sy = Math.floor(from.y / map.tileSize),
    tx = Math.floor(to.x / map.tileSize),
    ty = Math.floor(to.y / map.tileSize);
  const start = sy * map.width + sx,
    end = ty * map.width + tx;
  if (cellBlocked(map, sx, sy) || cellBlocked(map, tx, ty)) return [];
  const queue = [start],
    prev = new Map<number, number>([[start, -1]]);
  for (let k = 0; k < queue.length; k++) {
    const cell = queue[k];
    if (cell === end) break;
    const x = cell % map.width,
      y = Math.floor(cell / map.width);
    for (const [xx, yy] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      const next = yy * map.width + xx;
      if (!cellBlocked(map, xx, yy) && !prev.has(next)) {
        prev.set(next, cell);
        queue.push(next);
      }
    }
  }
  if (!prev.has(end)) return [];
  const path = [];
  let p = end;
  while (p !== -1) {
    path.push({
      x: ((p % map.width) + 0.5) * map.tileSize,
      y: (Math.floor(p / map.width) + 0.5) * map.tileSize,
    });
    p = prev.get(p)!;
  }
  return path.reverse();
}
