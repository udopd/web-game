import validators from "./generated/validators.cjs";
import type { TSchema } from "@sinclair/typebox";
import {
  definitions,
  collectionSchemas,
  type Content,
  type CollectionName,
  CONTENT_PATHS,
} from "./definitions";
import { EVENT_FIELDS } from "../../shared-types/src/index";
import {extensionCatalog} from '../../mutation-extensions/src/generated/catalog';
export type ValidationIssue = { path: string; message: string };
const extensionValidators=new Map(extensionCatalog.map(e=>[e.meta.id,validators[e.meta.id]]));
export function validateContent(
  value: unknown,
  extensions: Record<string, string> = Object.fromEntries(extensionCatalog.map(e=>[e.meta.id,e.meta.version])),
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });
  if (!value || typeof value !== "object" || Array.isArray(value))
    return [{ path: "content", message: "Content must be an object" }];
  const content = value as Content;
  for (const key of Object.keys(content))
    if (!(key in definitions)) add(key, "Unknown collection");
  for (const key of Object.keys(definitions) as CollectionName[]) {
    const v = validators[key];
    if (!v(content[key]))
      for (const err of v.errors ?? [])
        add(
          `${CONTENT_PATHS[key]}${err.instancePath}`,
          `${err.message} ${JSON.stringify(err.params)}`,
        );
  }
  if (errors.length) return errors;
  const indexes = Object.fromEntries(
    Object.entries(content).map(([key, col]) => [
      key,
      new Set(col.items.map((v: { id: string }) => v.id)),
    ]),
  );
  function walk(schema: TSchema, data: unknown, path: string) {
    if (data == null) return;
    if (
      schema["x-collection"] &&
      typeof data === "string" &&
      !indexes[schema["x-collection"]]?.has(data)
    )
      add(path, `Missing ${schema["x-collection"]} reference: ${data}`);
    if (schema.properties && typeof data === "object" && !Array.isArray(data))
      for (const [key, s] of Object.entries(schema.properties))
        walk(
          s as TSchema,
          (data as Record<string, unknown>)[key],
          path + "." + key,
        );
    if (schema.items && Array.isArray(data))
      data.forEach((v, j) => walk(schema.items, v, `${path}[${j}]`));
    if (schema.patternProperties && typeof data === 'object' && !Array.isArray(data))
      for (const [pattern, child] of Object.entries(schema.patternProperties))
        for (const [key, value] of Object.entries(data))
          if (new RegExp(pattern).test(key)) walk(child as TSchema, value, path+'.'+key);
    if (schema.anyOf)
      for (const branch of schema.anyOf as TSchema[]) {
        const discriminator = branch.properties?.type?.const;
        if (
          discriminator === undefined ||
          (data as { type?: string })?.type === discriminator
        )
          walk(branch, data, path);
      }
  }
  for (const key of Object.keys(definitions) as CollectionName[]) {
    const seen = new Set<string>();
    for (const row of content[key].items) {
      const p = `${CONTENT_PATHS[key]}:${row.id}`;
      if (seen.has(row.id)) add(p, "Duplicate ID");
      seen.add(row.id);
      walk(definitions[key], row, p);
    }
  }
  for (const c of content.characters.items) {
    for (const state of ["idle", "run", "hurt", "death", "victory"] as const)
      if (!c.animationSet[state])
        add(
          `characters:${c.id}.animationSet.${state}`,
          "Required player animation",
        );
    if (c.unlockRuleId) {
      const rule = content.unlocks.items.find((x) => x.id === c.unlockRuleId);
      if (rule?.rewardCharacterId !== c.id)
        add(`characters:${c.id}.unlockRuleId`, "Unlock ownership mismatch");
    }
  }
  for (const w of content.weapons.items) {
    if (["bullet", "shotgun", "bolt"].includes(w.class) && !w.projectileId)
      add(
        `weapons:${w.id}.projectileId`,
        "Projectile class requires projectile",
      );
    if (w.class === "laser" && !w.beamId)
      add(`weapons:${w.id}.beamId`, "Laser requires beam");
    if (w.class === "melee" && !w.melee)
      add(`weapons:${w.id}.melee`, "Melee requires volume");
  }
  for (const b of content.bosses.items) {
    const ratios = b.phases.map((x) => x.minHealthRatio);
    if (!ratios.includes(0) || new Set(ratios).size !== ratios.length)
      add(
        `bosses:${b.id}.phases`,
        "Phases must have unique thresholds and cover zero HP",
      );
  }
  for (const t of content.lootTables.items)
    for (const row of t.entries) {
      const key =
        row.rewardType === "weapon"
          ? "weapons"
          : row.rewardType === "mutation"
            ? "mutations"
            : "pickups";
      if (!indexes[key].has(row.rewardId))
        add(`lootTables:${t.id}`, `Missing ${key}: ${row.rewardId}`);
      if (row.min > row.max)
        add(`lootTables:${t.id}`, "Invalid reward quantity range");
    }
  for (const key of [
    "enemySpawnTables",
    "decorationSpawnTables",
    "chestSpawnTables",
  ] as const)
    for (const table of content[key].items) {
      const requiredKind = {enemySpawnTables:'enemy',decorationSpawnTables:'prop',chestSpawnTables:'chest'}[key];
      if(table.kind!==requiredKind)add(`${key}:${table.id}.kind`, `Expected ${requiredKind} spawn table`);
      const target =
        table.kind === "enemy"
          ? "enemies"
          : table.kind === "prop"
            ? "props"
            : "chests";
      if (table.min > table.max)
        add(`${key}:${table.id}`, "min must not exceed max");
      for (const row of table.entries)
        if (!indexes[target].has(row.definitionId))
          add(`${key}:${table.id}`, `Missing ${target}: ${row.definitionId}`);
    }
  for (const rule of content.generationRules.items)
    if (
      rule.minRoomSize > rule.maxRoomSize ||
      rule.maxRoomSize > Math.min(rule.width, rule.height) - 2
    )
      add(`generationRules:${rule.id}`, "Room dimensions do not fit map");
  for (const level of content.levels.items) {
    const biome=content.biomes.items.find(b=>b.id===level.biomeId)!;
    const palette=content.tilePalettes.items.find(p=>p.id===biome.paletteId)!;
    const rule=content.generationRules.items.find(r=>r.id===level.generationRuleId);
    const tilemap=content.tilemaps.items.find(m=>m.id===level.tilemapId);
    if(tilemap&&tilemap.paletteId!==palette.id)add(`levels:${level.id}.tilemapId`, 'Tilemap and biome palettes must match');
    if(rule){
      const floor=palette.tiles.find(t=>t.id===rule.floorTileId),wall=palette.tiles.find(t=>t.id===rule.wallTileId);
      if(!floor?.walkable||!wall||wall.walkable)add(`levels:${level.id}.generationRuleId`,'Generation requires a walkable floor and solid wall from the biome palette');
      for(const templateId of rule.requiredRoomTemplateIds){const template=content.roomTemplates.items.find(t=>t.id===templateId)!,map=content.tilemaps.items.find(m=>m.id===template.tilemapId)!;if(map.paletteId!==palette.id||map.width>rule.width-2||map.height>rule.height-2)add(`levels:${level.id}.generationRuleId`,'Room template must fit generation bounds and use the biome palette');}
    }
    if (level.generationMode === "handcrafted" && !level.tilemapId)
      add(`levels:${level.id}`, "Handcrafted level requires tilemap");
    if (level.generationMode !== "handcrafted" && !level.generationRuleId)
      add(`levels:${level.id}`, "Generated level requires generation rule");
  }
  for (const map of content.tilemaps.items) {
    const p = `tilemaps:${map.id}`;
    const palette = content.tilePalettes.items.find(
      (x) => x.id === map.paletteId,
    );
    const tiles = new Map(palette?.tiles.map((x) => [x.id, x]));
    const zoneIds=new Set<string>();
    for(const zone of map.spawnZones){
      if(zoneIds.has(zone.id))add(p+'.spawnZones','Duplicate zone ID');zoneIds.add(zone.id);
      if(zone.x+zone.width>map.width||zone.y+zone.height>map.height)add(p+'.spawnZones.'+zone.id,'Spawn zone outside map');
      const matches=[...content.enemySpawnTables.items,...content.decorationSpawnTables.items,...content.chestSpawnTables.items].filter(t=>t.id===zone.tableId);
      if(matches.length!==1)add(p+'.spawnZones.'+zone.id,'Missing or ambiguous spawn table');
    }
    for (const layer of map.layers) {
      if (
        layer.cells.length !== map.height ||
        layer.cells.some((row) => row.length !== map.width)
      )
        add(p + ".layers", "Layer dimensions mismatch");
      for (const row of layer.cells)
        for (const id of row)
          if (id && !tiles.has(id)) add(p, `Unknown tile ${id}`);
    }
    const blocked = (x: number, y: number) =>
      x < 0 ||
      y < 0 ||
      x >= map.width ||
      y >= map.height ||
      map.layers.some((l) => {
        const tile = l.cells[y]?.[x];
        return tile && !tiles.get(tile)?.walkable;
      });
    const size = palette?.tileSize ?? 16;
    const starts = map.placements.filter((x) => x.kind === "player_spawn");
    const exits = map.placements.filter((x) => x.kind === "level_exit");
    if (!starts.length || !exits.length)
      add(p, "Map requires player spawn and exit");
    for (const placement of map.placements) {
      const x = Math.floor(placement.position.x / size),
        y = Math.floor(placement.position.y / size);
      if (blocked(x, y))
        add(p + "." + placement.placementId, "Placement inside blocked cell");
      const target = {
        enemy: "enemies",
        boss: "bosses",
        prop: "props",
        chest: "chests",
      }[placement.kind as "enemy"];
      if (
        target &&
        (!placement.definitionId ||
          !indexes[target].has(placement.definitionId))
      )
        add(p + "." + placement.placementId, "Missing definition");
    }
    if (starts[0]) {
      const start = starts[0].position;
      const queue = [[Math.floor(start.x / size), Math.floor(start.y / size)]];
        const visited = new Set<string>();
        const enqueued = new Set<string>([queue[0].join(',')]);
        for (let q = 0; q < queue.length; q++) {
        const [x, y] = queue[q];
        const id = x + "," + y;
        if (visited.has(id) || blocked(x, y)) continue;
        visited.add(id);
          for(const cell of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){const key=cell.join(',');if(!enqueued.has(key)&&!blocked(cell[0],cell[1])){enqueued.add(key);queue.push(cell);}}
      }
      for (const exit of exits)
        if (
          !visited.has(
            Math.floor(exit.position.x / size) +
              "," +
              Math.floor(exit.position.y / size),
          )
        )
          add(p, "Exit unreachable");
    }
  }
  for (const graph of content.graphs.items) {
    const ids = graph.nodes.map((x) => x.id);
    const edges = graph.edges.map((x) => [x.from, x.to] as [string, string]);
    validateGraph(
      ids,
      edges,
      graph.nodes.find((x) => x.type === "event")?.id ?? "",
      `graphs:${graph.id}`,
      add,
    );
    for (const node of graph.nodes) {
      if (node.type === "action" && !node.action)
        add(`graphs:${graph.id}.${node.id}`, "Action missing");
      if (node.type === "condition" && !node.condition)
        add(`graphs:${graph.id}.${node.id}`, "Condition missing");
    }
  }
  for (const graph of content.campaigns.items) {
    validateGraph(
      graph.nodes.map((x) => x.nodeId),
      graph.edges.map((x) => [x.fromNodeId, x.toNodeId]),
      graph.startNodeId,
      `campaigns:${graph.id}`,
      add,
    );
    if (!graph.nodes.some((n) => n.kind === "end") && !graph.endless)
      add(`campaigns:${graph.id}`, "Finite campaign needs end node");
    for (const node of graph.nodes)
      if (["level", "boss"].includes(node.kind) && !node.levelId)
        add(`campaigns:${graph.id}.${node.nodeId}`, "Level reference required");
  }
  for (const effect of content.effects.items) {
    if(effect.mode==='custom_extension'&&effect.extensionId){const installed=extensionCatalog.find(e=>e.meta.id===effect.extensionId),validator=extensionValidators.get(effect.extensionId);if(validator&&!validator(effect.params))add(`effects:${effect.id}.params`,(validator.errors??[]).map(e=>`${e.instancePath} ${e.message}`).join('; '));if(installed&&!installed.meta.subscribedEvents.includes(effect.event))add(`effects:${effect.id}.event`,'Event is not subscribed by extension');if(installed)walk(installed.params as unknown as TSchema,effect.params,`effects:${effect.id}.params`);}
    if (
      effect.mode === "custom_extension" &&
      (!effect.extensionId ||
        extensions[effect.extensionId] !== effect.extensionVersion)
    )
      add(`effects:${effect.id}`, "Unknown or incompatible trusted extension");
    if (effect.mode === "graph" && !effect.graphId)
      add(`effects:${effect.id}`, "Graph reference required");
  }
  for (const binding of [
    ...content.effects.items,
    ...content.eventBindings.items,
  ])
    for (const condition of binding.conditions) {
      if (
        !(EVENT_FIELDS[binding.event] as readonly string[]).includes(
          condition.field,
        )
      )
        add(
          `bindings:${binding.id}.${condition.field}`,
          "Field unavailable for event",
        );
    }
  for (const p of content.particles.items) {
    for (const field of ["sizeOverLife", "alphaOverLife"] as const) {
      const points = p[field];
      if (
        points.length < 2 ||
        points[0].t !== 0 ||
        points.at(-1)?.t !== 1 ||
        points.some((v, j) => j > 0 && v.t <= points[j - 1].t)
      )
        add(`particles:${p.id}.${field}`, "Curve must increase from 0 to 1");
    }
    if (
      p.motion.speed.min > p.motion.speed.max ||
      p.lifetimeMs.min > p.lifetimeMs.max
    )
      add(`particles:${p.id}`, "Invalid range");
  }
  return [...new Map(errors.map((x) => [x.path + x.message, x])).values()];
}
function validateGraph(
  ids: string[],
  edges: [string, string][],
  start: string,
  path: string,
  add: (p: string, m: string) => void,
) {
  const set = new Set(ids);
  if (set.size !== ids.length) add(path, "Duplicate node ID");
  if (!set.has(start)) add(path, "Missing start node");
  for (const [a, b] of edges)
    if (!set.has(a) || !set.has(b)) add(path, "Dangling edge");
  const active = new Set<string>(),
    seen = new Set<string>();
  let cycle = false;
  function visit(id: string) {
    if (active.has(id)) {
      cycle = true;
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    active.add(id);
    for (const edge of edges) if (edge[0] === id) visit(edge[1]);
    active.delete(id);
  }
  visit(start);
  if (cycle) add(path, "Unbounded cycle");
  if (ids.some((id) => !seen.has(id))) add(path, "Unreachable node");
}
export function assertContent(value: unknown): asserts value is Content {
  const issues = validateContent(value);
  if (issues.length) throw new Error(JSON.stringify(issues));
}
