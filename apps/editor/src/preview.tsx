import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, StepForward, Bug } from "lucide-react";
import { useStudio } from "./store";
import { ContentRegistry } from "../../../packages/content-loader/src/registry";
import { Simulation } from "../../../packages/simulation/src/simulation";
import { GameView } from "../../../packages/presentation/src/game-view";
import { DEFAULT_SETTINGS } from "../../../packages/shared-types/src/index";
import { animationFrame } from "../../../packages/presentation/src/animation";
import { dropChance } from "../../../packages/simulation/src/rewards";
export const assetUrl = (path: string) =>
  `/api/editor/asset?key=${encodeURIComponent(path)}`;
export function SpritePreview({
  id,
  width = 160,
}: {
  id: string;
  width?: number;
}) {
  const draft = useStudio((s) => s.draft),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const d = draft?.content.sprites.items.find((s) => s.id === id);
    if (!d) return;
    const image = new Image();
    image.onload = () => {
      if (!canvas.current) return;
      const ctx = canvas.current.getContext("2d")!;
      ctx.clearRect(0, 0, width, width);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        image,
        d.frame.x,
        d.frame.y,
        d.frame.width,
        d.frame.height,
        0,
        0,
        width,
        width,
      );
    };
    image.src = assetUrl(d.source);
  }, [draft?.content.sprites, id, width]);
  return <canvas ref={canvas} width={width} height={width} />;
}
export function Workbench() {
  const container = useRef<HTMLDivElement>(null),
    view = useRef<GameView | undefined>(undefined),
    sim = useRef<Simulation | undefined>(undefined);
  const draft = useStudio((s) => s.draft),
    selection = useStudio((s) => s.selection);
  const [running, setRunning] = useState(false),
    [seed, setSeed] = useState(42),
    [tick, setTick] = useState(0),
    [error, setError] = useState(""),
    [applied, setApplied] = useState(-1),
    [debug, setDebug] = useState(false),
    [campaign, setCampaign] = useState("");
  const contentRef = useRef(draft?.content);
  const changeId = useStudio((s) => s.previewVersion);
  contentRef.current = draft?.content;
  const runningRef = useRef(running);
  runningRef.current = running;
  const reset = () => {
    view.current?.dispose();
    view.current = undefined;
    sim.current = undefined;
    setError("");
    try {
      if (!container.current || !draft) return;
      const registry = new ContentRegistry(draft.content, "preview");
      const simulation = new Simulation(registry, {
        runId: "editor",
        seed,
        campaignId: campaign || registry.all("campaigns")[0].id,
        players: [
          {
            id: "preview",
            characterId:
              selection?.collection === "characters"
                ? selection.id
                : registry.all("characters")[0].id,
          },
        ],
      });
      if (selection?.collection === "weapons") {
        const a = simulation.state.actors[0];
        a.weaponIds = [selection.id];
        a.ammo = {
          [selection.id]: registry.get("weapons", selection.id).magazineSize,
        };
      }
      if (selection?.collection === "mutations")
        simulation.state.actors[0].mutations = [selection.id];
      const game = new GameView({
        parent: container.current,
        registry,
        assetUrl,
        localId: "preview",
        settings: { ...DEFAULT_SETTINGS, musicVolume: 20 },
        error: setError,
        input: (input) => simulation.input("preview", input),
      });
      game.debug = debug;
      sim.current = simulation;
      view.current = game;
      game.snapshot(simulation.snapshot());
      setApplied(changeId);
      setTick(0);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  };
  useEffect(() => {
    reset();
    const timer = setInterval(() => {
      if (runningRef.current && sim.current) {
        sim.current.step();
        view.current?.snapshot(sim.current.snapshot());
        setTick(sim.current.state.tick);
      }
    }, 1000 / 30);
    return () => {
      clearInterval(timer);
      view.current?.dispose();
    };
  }, []);
  return (
    <div className="workbench">
      <div className="toolbar">
        <button
          aria-label={running ? "Пауза" : "Запустить превью"}
          onClick={() => {
            void view.current?.router.audio.unlock();
            setRunning(!running);
          }}
        >
          {running ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          aria-label="Один тик"
          onClick={() => {
            sim.current?.step();
            if (sim.current) {
              view.current?.snapshot(sim.current.snapshot());
              setTick(sim.current.state.tick);
            }
          }}
        >
          <StepForward size={14} />
        </button>
        <button onClick={reset}>
          <RotateCcw size={13} />
          Применить
        </button>
        <label>
          Seed{" "}
          <input
            aria-label="Preview seed"
            type="number"
            value={seed}
            min={0}
            max={4294967295}
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>
        <select
          aria-label="Кампания превью"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
        >
          {draft?.content.campaigns.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className={debug ? "active" : ""}
          aria-label="Коллизии"
          onClick={() => {
            setDebug(!debug);
            if (view.current) view.current.debug = !debug;
          }}
        >
          <Bug size={14} />
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="preview-game" ref={container} />
      <div className="preview-status">
        <i className={running ? "live" : ""} />
        {error
          ? "ERROR"
          : applied !== changeId
            ? "STALE · примените изменения"
            : running
              ? "RUNNING"
              : "PAUSED"}
        <span>
          Тик {tick} · {sim.current?.state.actors.length ?? 0} объектов
        </span>
        <span>WASD · ЛКМ · E</span>
      </div>
    </div>
  );
}
export function AssetPreview() {
  const { draft, selection } = useStudio();
  const [elapsed, setElapsed] = useState(0),
    [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - elapsed,
      timer = setInterval(() => setElapsed(performance.now() - start), 50);
    return () => clearInterval(timer);
  }, [playing, selection?.id]);
  if (!draft || !selection)
    return <div className="empty">Выберите ресурс для просмотра</div>;
  const item: any = draft.content[selection.collection].items.find(
    (x) => x.id === selection.id,
  );
  if (!item) return null;
  let sprite = item.spriteId ?? item.iconSpriteId;
  if (selection.collection === "sprites") sprite = item.id;
  if (selection.collection === "animations")
    sprite = animationFrame(item, elapsed).frame.spriteId;
  return (
    <div className="asset-preview panel-scroll">
      <div className="checker">
        {sprite ? (
          <SpritePreview id={sprite} width={200} />
        ) : (
          <div className="empty">{item.name}</div>
        )}
      </div>
      {selection.collection === "animations" && (
        <>
          <div className="toolbar">
            <button onClick={() => setPlaying(!playing)}>
              {playing ? "Пауза" : "Воспроизвести"}
            </button>
            <button onClick={() => setElapsed(0)}>Сначала</button>
            <span>{Math.round(elapsed)} мс</span>
          </div>
          <div className="timeline">
            {item.frames.map((f: any, i: number) => (
              <button
                key={i}
                className={
                  animationFrame(item, elapsed).index === i ? "active" : ""
                }
                onClick={() => {
                  setPlaying(false);
                  setElapsed(
                    item.frames
                      .slice(0, i)
                      .reduce((s: number, x: any) => s + x.durationMs, 0),
                  );
                }}
              >
                <SpritePreview id={f.spriteId} width={45} />
                <small>{f.durationMs} ms</small>
              </button>
            ))}
          </div>
        </>
      )}
      {["sounds", "music"].includes(selection.collection) && (
        <audio controls src={assetUrl(item.source)} preload="metadata" />
      )}
      {selection.collection === "dropRules" && (
        <>
          <h3>Шанс выпадения по сложности</h3>
          <svg viewBox="0 0 300 120" aria-label="График шанса выпадения">
            <line x1="10" y1="110" x2="290" y2="110" stroke="#61756b" />
            <polyline
              fill="none"
              stroke="#b5df8e"
              strokeWidth="2"
              points={Array.from(
                { length: 100 },
                (_, i) =>
                  `${10 + i * 2.8},${110 - dropChance(item, i + 1, 1, false) * 100}`,
              ).join(" ")}
            />
          </svg>
          <small>Сложность 1–100 · вероятность 0–100%</small>
        </>
      )}
      {selection.collection === "particles" && (
        <>
          <h3>Кривые размера и прозрачности</h3>
          <svg viewBox="0 0 300 100">
            {["sizeOverLife", "alphaOverLife"].map((key, i) => (
              <polyline
                key={key}
                fill="none"
                stroke={i ? "#e8bb76" : "#b5df8e"}
                strokeWidth="2"
                points={item[key]
                  .map((p: any) => `${p.t * 290 + 5},${95 - p.value * 60}`)
                  .join(" ")}
              />
            ))}
          </svg>
        </>
      )}
      <p className="help">
        Изображение берётся из текущего черновика. Изменения области кадра,
        масштаба и анимации доступны в инспекторе.
      </p>
    </div>
  );
}
