import React, { useEffect, useRef, useState } from "react";
import { useStudio } from "./store";
import { assetUrl } from "./preview";
import type { Definition } from "../../../packages/content-schemas/src/definitions";
export function TilemapStudio() {
  const { draft, selection, edit } = useStudio();
  const map =
    selection?.collection === "tilemaps"
      ? draft?.content.tilemaps.items.find((m) => m.id === selection.id)
      : undefined;
  const canvas = useRef<HTMLCanvasElement>(null),
    working = useRef<Definition<"tilemaps"> | undefined>(undefined),
    images = useRef(new Map<string, HTMLImageElement>());
  const [zoom, setZoom] = useState(2),
    [layer, setLayer] = useState(0),
    [tile, setTile] = useState(""),
    [tool, setTool] = useState("brush"),
    [grid, setGrid] = useState(true),
    [collision, setCollision] = useState(false),
    [placement, setPlacement] = useState("player_spawn"),
    [definition, setDefinition] = useState(""),
    [cursor, setCursor] = useState("");
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const palette = draft?.content.tilePalettes.items.find(
    (p) => p.id === map?.paletteId,
  );
  const draw = (data = working.current ?? map) => {
    if (!canvas.current || !data || !palette) return;
    const ctx = canvas.current.getContext("2d")!,
      size = palette.tileSize * zoom;
    canvas.current.width = data.width * size;
    canvas.current.height = data.height * size;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#17222a";
    ctx.fillRect(0, 0, canvas.current.width, canvas.current.height);
    for (const l of data.layers)
      for (let y = 0; y < data.height; y++)
        for (let x = 0; x < data.width; x++) {
          const def = palette.tiles.find((t) => t.id === l.cells[y]?.[x]);
          if (!def) continue;
          const s = draft!.content.sprites.items.find(
            (s) => s.id === def.spriteId,
          )!;
          let image = images.current.get(s.source);
          if (!image) {
            image = new Image();
            image.src = assetUrl(s.source);
            image.onload = () => draw();
            images.current.set(s.source, image);
          }
          if (image.complete && image.naturalWidth)
            ctx.drawImage(
              image,
              s.frame.x,
              s.frame.y,
              s.frame.width,
              s.frame.height,
              x * size,
              y * size,
              size,
              size,
            );
          if (collision && !def.walkable) {
            ctx.fillStyle = "#e95d7840";
            ctx.fillRect(x * size, y * size, size, size);
          }
        }
    if (grid) {
      ctx.strokeStyle = "#90bca922";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= data.width; x++) {
        ctx.moveTo(x * size, 0);
        ctx.lineTo(x * size, data.height * size);
      }
      for (let y = 0; y <= data.height; y++) {
        ctx.moveTo(0, y * size);
        ctx.lineTo(data.width * size, y * size);
      }
      ctx.stroke();
    }
    for (const p of data.placements) {
      ctx.fillStyle =
        p.kind === "player_spawn"
          ? "#9fdb83"
          : p.kind === "level_exit"
            ? "#efbf76"
            : "#df8282";
      ctx.beginPath();
      ctx.arc(
        p.position.x * zoom,
        p.position.y * zoom,
        5 * zoom,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = "#f2f4e9";
      ctx.font = "10px sans-serif";
      ctx.fillText(p.kind, p.position.x * zoom + 8, p.position.y * zoom - 4);
    }
  };
  useEffect(() => {
    working.current = undefined;
    draw();
  }, [map, zoom, grid, collision, palette]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(),
      size = (palette?.tileSize ?? 16) * zoom;
    return {
      x: Math.floor((e.clientX - rect.left) / size),
      y: Math.floor((e.clientY - rect.top) / size),
    };
  };
  const paint = (p: { x: number; y: number }) => {
    const data = working.current;
    if (
      !data ||
      !palette ||
      p.x < 0 ||
      p.y < 0 ||
      p.x >= data.width ||
      p.y >= data.height
    )
      return;
    const cells = data.layers[Math.min(layer, data.layers.length - 1)].cells;
    const value = tool === "erase" ? null : tile || palette.tiles[0].id;
    if (tool === "fill") {
      const from = cells[p.y][p.x];
      if (from === value) return;
      const queue = [p];
      cells[p.y][p.x] = value;
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        for (const n of [
          { x: c.x - 1, y: c.y },
          { x: c.x + 1, y: c.y },
          { x: c.x, y: c.y - 1 },
          { x: c.x, y: c.y + 1 },
        ])
          if (
            n.x >= 0 &&
            n.y >= 0 &&
            n.x < data.width &&
            n.y < data.height &&
            cells[n.y][n.x] === from
          ) {
            cells[n.y][n.x] = value;
            queue.push(n);
          }
      }
    } else cells[p.y][p.x] = value;
    draw();
  };
  if (!map || !palette)
    return (
      <div className="empty">Выберите tilemap в разделе «Карты и комнаты».</div>
    );
  return (
    <div className="tilemap-studio">
      <div className="toolbar">
        <select
          aria-label="Инструмент карты"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
        >
          {[
            ["brush", "Кисть"],
            ["erase", "Ластик"],
            ["fill", "Заливка"],
            ["rectangle", "Прямоугольник"],
            ["placement", "Объект"],
            ["remove", "Удалить объект"],
          ].map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Слой карты"
          value={layer}
          onChange={(e) => setLayer(Number(e.target.value))}
        >
          {map.layers.map((l, i) => (
            <option key={l.id} value={i}>
              {l.id}
            </option>
          ))}
        </select>
        <select
          aria-label="Тайл"
          value={tile}
          onChange={(e) => setTile(e.target.value)}
        >
          {palette.tiles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id}
            </option>
          ))}
        </select>
        <label>
          Zoom{" "}
          <input
            aria-label="Масштаб карты"
            type="number"
            min={1}
            max={4}
            value={zoom}
            onChange={(e) =>
              setZoom(Math.max(1, Math.min(4, Number(e.target.value))))
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={grid}
            onChange={(e) => setGrid(e.target.checked)}
          />{" "}
          Сетка
        </label>
        <label>
          <input
            type="checkbox"
            checked={collision}
            onChange={(e) => setCollision(e.target.checked)}
          />{" "}
          Коллизии
        </label>
      </div>
      {tool === "placement" && (
        <div className="toolbar">
          <select
            aria-label="Тип объекта карты"
            value={placement}
            onChange={(e) => {
              setPlacement(e.target.value);
              setDefinition("");
            }}
          >
            {[
              "player_spawn",
              "level_exit",
              "enemy",
              "boss",
              "prop",
              "chest",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          {!["player_spawn", "level_exit"].includes(placement) && (
            <select
              aria-label="Определение объекта"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
            >
              <option value="">Выберите объект</option>
              {draft!.content[
                (
                  {
                    enemy: "enemies",
                    boss: "bosses",
                    prop: "props",
                    chest: "chests",
                  } as const
                )[placement as "enemy"]
              ].items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="map-scroll">
        <canvas
          ref={canvas}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            working.current = structuredClone(map);
            const p = point(e);
            start.current = p;
            if (tool === "placement") {
              if (
                !["player_spawn", "level_exit"].includes(placement) &&
                !definition
              )
                return;
              const data = working.current;
              if (["player_spawn", "level_exit"].includes(placement))
                data.placements = data.placements.filter(
                  (p) => p.kind !== placement,
                );
              data.placements.push({
                placementId: `placed-${Date.now().toString(36)}`,
                kind: placement as any,
                ...(definition ? { definitionId: definition } : {}),
                position: {
                  x: (p.x + 0.5) * palette.tileSize,
                  y: (p.y + 0.5) * palette.tileSize,
                },
              });
              draw();
            } else if (tool === "remove") {
              working.current.placements = working.current.placements.filter(
                (v) =>
                  Math.floor(v.position.x / palette.tileSize) !== p.x ||
                  Math.floor(v.position.y / palette.tileSize) !== p.y,
              );
              draw();
            } else if (tool !== "rectangle") paint(p);
          }}
          onPointerMove={(e) => {
            const p = point(e);
            setCursor(`${p.x}, ${p.y}`);
            if (
              e.buttons &&
              working.current &&
              ["brush", "erase"].includes(tool)
            )
              paint(p);
          }}
          onPointerUp={(e) => {
            if (!working.current) return;
            if (tool === "rectangle" && start.current) {
              const end = point(e);
              for (
                let y = Math.min(start.current.y, end.y);
                y <= Math.max(start.current.y, end.y);
                y++
              )
                for (
                  let x = Math.min(start.current.x, end.x);
                  x <= Math.max(start.current.x, end.x);
                  x++
                )
                  paint({ x, y });
            }
            edit("tilemaps", map.id, working.current);
            working.current = undefined;
            start.current = undefined;
          }}
        />
      </div>
      <div className="preview-status">
        {map.width} × {map.height} · {palette.tileSize}px
        <span>{map.placements.length} объектов</span>
        <span>Клетка {cursor}</span>
      </div>
    </div>
  );
}
