import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  AudioLines,
  ChevronRight,
  Copy,
  Leaf,
  Play,
  Settings,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { api, setCsrf } from "../../../packages/editor-components/src/api";
import { loadPublishedContent } from "../../../packages/content-loader/src/browser";
import type { RoomView } from "../../../packages/multiplayer-protocol/src/index";
import type { WorldState } from "../../../packages/simulation/src/types";
import {
  DEFAULT_SETTINGS,
  type UserSettings,
} from "../../../packages/shared-types/src/index";
import type { GameView } from "../../../packages/presentation/src/game-view";
import "./style.css";
type Pack = Awaited<ReturnType<typeof loadPublishedContent>>;
type Profile = {
  uid: string;
  name: string;
  kills: number;
  maxDepth: number;
  deaths: number;
  settings: UserSettings;
  csrf: string;
  unlocks: { characterId: string }[];
  rooms: RoomView[];
};
function Sprite({
  pack,
  id,
  size = 80,
}: {
  pack: Pack;
  id: string;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const d = pack.registry.get("sprites", id),
      image = new Image();
    image.onload = () => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        image,
        d.frame.x,
        d.frame.y,
        d.frame.width,
        d.frame.height,
        0,
        0,
        size,
        size,
      );
    };
    image.src = pack.assetUrl(d.source);
  }, [id, pack, size]);
  return <canvas width={size} height={size} ref={canvas} />;
}
function App() {
  const [pack, setPack] = useState<Pack>();
  const [profile, setProfile] = useState<Profile>();
  const [room, setRoom] = useState<RoomView>();
  const [world, setWorld] = useState<WorldState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState("Загружаем мир");
  const [tab, setTab] = useState("play");
  const [name, setName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [character, setCharacter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaders, setLeaders] = useState<Profile[]>([]);
  const [runs, setRuns] = useState<
    {
      run: { id: string; status: string; startedAt: string };
      countedKills: number;
    }[]
  >([]);
  const [online, setOnline] = useState(false);
  const [reset, setReset] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<GameView | undefined>(undefined);
  const socket = useRef<WebSocket | undefined>(undefined);
  const worldRef = useRef<WorldState | undefined>(undefined);
  const packRef = useRef<Pack | undefined>(undefined);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const me = async () => {
    const p = await api<Profile>("/api/users/me");
    setProfile(p);
    setCsrf(p.csrf);
    return p;
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let p: Profile | undefined;
        try {
          p = await me();
        } catch {}
        const current = await api<{ version: string }>("/api/content/current");
        const active = p?.rooms[0];
        const loaded = await loadPublishedContent(
          active?.contentVersion ?? current.version,
          (n, t) => setLoading(`Загрузка ресурсов ${n} / ${t}`),
        );
        if (cancelled) {
          loaded.dispose();
          return;
        }
        packRef.current = loaded;
        setPack(loaded);
        setCharacter(loaded.registry.all("characters")[0].id);
        if (active) setRoom(active);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      packRef.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (!room?.id || !profile) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    const connect = () => {
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/rooms/${room.id}`,
      );
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setOnline(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "room") setRoom(msg.room);
        if (msg.type === "snapshot") {
          worldRef.current = msg.state;
          const currentView = view.current;
          if(currentView && currentView.options.registry.version===msg.state.contentVersion)currentView.snapshot(msg.state);
          setWorld(msg.state);
        }
        if (msg.type === "events" && view.current) {
          const listener = worldRef.current?.actors.find(
            (a) => a.id === profile.uid,
          ) ?? { x: 0, y: 0 };
          for (const event of msg.events)
            view.current.router.dispatch(event, listener);
        }
        if (msg.type === "error") setError(msg.message);
      };
      ws.onclose = (event) => {
        setOnline(false);
        if (stopped || event.code === 1008) return;
        timer = setTimeout(connect, Math.min(10000, 500 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
      socket.current = undefined;
    };
  }, [room?.id, profile?.uid]);
  useEffect(() => {
    if (
      !container.current ||
      !pack ||
      !profile ||
      !room ||
      room.status === "lobby"
    )
      return;
    let cancelled=false;let v:GameView|undefined;
    void import('../../../packages/presentation/src/game-view').then(({GameView})=>{if(cancelled||!container.current)return;v = new GameView({
      parent: container.current,
      registry: pack.registry,
      assetUrl: pack.assetUrl,
      localId: profile.uid,
      settings: profile.settings,
      error: setError,
      input: (input) => {
        if (socket.current?.readyState === 1)
          socket.current.send(JSON.stringify({ type: "input", input }));
      },
    });
    view.current = v;
    if (worldRef.current?.contentVersion===pack.registry.version) v.snapshot(worldRef.current);
    }).catch(e=>setError(e.message));
    return () => {
      cancelled=true;v?.dispose();
      view.current = undefined;
    };
  }, [pack, profile?.uid, room?.id, room?.status === "lobby", tab]);
  useEffect(()=>{if(!room||!pack||room.contentVersion===pack.registry.version)return;let cancelled=false;void loadPublishedContent(room.contentVersion).then(loaded=>{if(cancelled){loaded.dispose();return;}const previous=packRef.current;packRef.current=loaded;setPack(loaded);setTimeout(()=>previous?.dispose(),1000);}).catch(e=>setError(e.message));return()=>{cancelled=true;};},[room?.contentVersion,pack?.registry.version]);
  useEffect(() => {
    if (profile) view.current?.updateSettings(profile.settings);
  }, [profile?.settings]);
  useEffect(() => {
    if (tab === "leaderboard")
      void action(async () =>
        setLeaders(await api<Profile[]>("/api/leaderboard?sort=depth")),
      );
    if (tab === "profile" && profile)
      void action(async () => {
        await me();
        setRuns(await api<typeof runs>("/api/users/me/runs"));
      });
  }, [tab]);
  const setSettings = async (patch: Partial<UserSettings>) => {
    const next = await api<UserSettings>(
      "/api/users/me/settings",
      "PATCH",
      patch,
    );
    setProfile((p) => (p ? { ...p, settings: next } : p));
  };
  const create = () =>
    action(async () => {
      if (!profile) throw new Error("Сначала выберите имя исследователя");
      const r = await api<RoomView>("/api/rooms", "POST", {
        campaignId: pack!.registry.all("campaigns")[0].id,
      });
      setRoom(r);
    });
  const leave = () =>
    action(async () => {
      await api(`/api/rooms/${room!.id}/leave`, "POST");
      setRoom(undefined);
      setWorld(undefined);
      worldRef.current = undefined;
      await me();
    });
  const local = world?.actors.find((a) => a.id === profile?.uid);
  const active = room && room.status !== "lobby";
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-symbol">
            <Leaf size={23} />
          </span>
          <span>
            EMBERFALL<small>THE OVERGROWTH AWAITS</small>
          </span>
        </a>
        <p className="nav-caption">EXPLORE</p>
        {[
          ["play", "Играть", Play],
          ["characters", "Персонажи", Users],
          ["leaderboard", "Рейтинг", Trophy],
          ["profile", "Мой путь", Shield],
        ].map(([id, label, Icon]) => (
          <button
            key={id as string}
            className={`nav-item ${tab === id ? "selected" : ""}`}
            onClick={() => setTab(id as string)}
          >
            <Icon size={19} />
            {label as string}
            {tab === id && <ChevronRight size={16} />}
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="version">
            <i /> CONTENT {pack?.registry.version ?? "…"}
          </div>
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
            Настройки
          </button>
          <a className="nav-item" href="/editor">
            <Swords size={18} />
            Content Studio
            <ArrowUpRight size={15} />
          </a>
          <div className="profile-mini">
            <span>{profile?.name.slice(0, 1) ?? "?"}</span>
            <div>
              {profile?.name ?? "Новый исследователь"}
              <small>
                {profile ? "Профиль сохранён" : "Выберите имя, чтобы начать"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            <span className="muted">Emberfall / </span>
            {tab === "play"
              ? "Экспедиция"
              : tab === "characters"
                ? "Персонажи"
                : tab === "leaderboard"
                  ? "Рейтинг"
                  : "Мой путь"}
          </span>
          <span className="status-pill">
            <i />
            {room
              ? online
                ? "В комнате"
                : "Переподключение…"
              : "Система готова"}
          </span>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Закрыть ошибку" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!pack ? (
          <div className="loading">
            <Leaf size={40} />
            <h2>{error ? "Не удалось загрузить мир" : loading}</h2>
          </div>
        ) : (
          <div className="content">
            {tab === "play" && (
              <>
                {active ? (
                  <>
                    <div className="section-heading">
                      <div>
                        <small>
                          LIVE EXPEDITION ·{" "}
                          {online ? "CONNECTED" : "RECONNECTING"}
                        </small>
                        <h1>
                          {
                            pack.registry.get(
                              "levels",
                              world?.levelId ??
                                pack.registry.all("levels")[0].id,
                            ).name
                          }
                        </h1>
                      </div>
                      <button className="secondary" onClick={leave}>
                        Покинуть
                      </button>
                    </div>
                    <div className="game-wrap">
                      <div className="game-canvas" ref={container} />
                      <div className="game-hud">
                        <span>ГЛУБИНА {world?.depth ?? 1}</span>
                        <span>
                          ♥ {Math.ceil(local?.hp ?? 0)} / {local?.maxHp ?? 100}
                        </span>
                        <span>
                          {local?.weaponIds[local.weaponSlot]
                            ? `${pack.registry.get("weapons", local.weaponIds[local.weaponSlot]).name} · ${local.ammo[local.weaponIds[local.weaponSlot]]} / ${local.reserve}`
                            : ""}
                        </span>
                        <span>УБИЙСТВ {local?.kills ?? 0}</span>
                      </div>
                      {world && world.status !== "running" && (
                        <div className="game-overlay">
                          <Trophy size={40} />
                          <h2>
                            {world.status === "victory"
                              ? "Экспедиция завершена"
                              : "Экспедиция потеряна"}
                          </h2>
                          <p>
                            Глубина {world.depth} · Убийств {local?.kills ?? 0}
                          </p>
                          <button onClick={leave}>Вернуться в лагерь</button>
                        </div>
                      )}
                      {!!local?.mutationChoices.length && (
                        <div className="mutation-overlay">
                          <small>НОВАЯ МУТАЦИЯ</small>
                          <h2>Выберите свой путь</h2>
                          <div>
                            {local.mutationChoices.map((id) => {
                              const m = pack.registry.get("mutations", id);
                              return (
                                <button
                                  key={id}
                                  onClick={() =>
                                    view.current?.chooseMutation(id)
                                  }
                                >
                                  <Sprite
                                    pack={pack}
                                    id={m.iconSpriteId}
                                    size={50}
                                  />
                                  <strong>{m.name}</strong>
                                  <small>{m.description}</small>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="control-help">
                      <span>
                        <kbd>W A S D</kbd> Движение
                      </span>
                      <span>
                        <kbd>ЛКМ</kbd> Огонь
                      </span>
                      <span>
                        <kbd>1–5</kbd> Оружие
                      </span>
                      <span>
                        <kbd>E</kbd> Сундук / выход
                      </span>
                      <span>
                        Сид {world?.seed} · тик {world?.tick}
                      </span>
                    </div>
                    {world?.completed && (
                      <div className="notice">
                        Уровень очищен. Найдите зелёный выход и нажмите E.{" "}
                        {pack.registry
                          .get("campaigns", world.campaignId)
                          .edges.filter(
                            (e) =>
                              e.fromNodeId === world.nodeId &&
                              e.selection === "player_choice",
                          )
                          .map((e) => (
                            <button
                              key={e.edgeId}
                              onClick={() =>
                                view.current?.chooseExit(e.toNodeId)
                              }
                            >
                              {e.toNodeId}
                            </button>
                          ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <section className="hero">
                      <div className="hero-copy">
                        <span className="eyebrow">
                          <i /> CO-OP ROGUELIKE · 1–4 PLAYERS
                        </span>
                        <h1>
                          Там, где руины
                          <br />
                          <em>снова оживают.</em>
                        </h1>
                        <p>
                          Погрузитесь в заросшие глубины. Собирайте оружие,
                          меняйтесь и найдите то, что всё ещё живёт под землёй.
                        </p>
                        <button
                          className="primary"
                          disabled={busy || !profile || !!room}
                          onClick={create}
                        >
                          <Play size={17} fill="currentColor" />
                          Начать экспедицию
                          <ArrowUpRight size={18} />
                        </button>
                        <div className="hero-foot">
                          <span>
                            <Sparkles size={15} /> Каждый забег — новый мир
                          </span>
                          <span>
                            <Users size={15} /> Лучше вместе
                          </span>
                        </div>
                      </div>
                      <div className="hero-art">
                        <div className="orbit one" />
                        <div className="orbit two" />
                        <div className="hero-scout">
                          <Sprite
                            pack={pack}
                            id={pack.registry.all("characters")[0].spriteId}
                            size={300}
                          />
                        </div>
                        <div className="floating-art a">
                          <Sprite
                            pack={pack}
                            id={pack.registry.all("enemies")[0].spriteId}
                            size={90}
                          />
                        </div>
                        <div className="floating-art b">
                          <Sprite
                            pack={pack}
                            id={pack.registry.all("chests")[0].spriteId}
                            size={85}
                          />
                        </div>
                        <div className="art-caption">
                          <i /> SPECIMEN 001 — THE SCOUT
                        </div>
                      </div>
                    </section>
                    {!profile && (
                      <form
                        className="registration card"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void action(async () => {
                            const r = await api<{ csrf: string }>(
                              "/api/register",
                              "POST",
                              { name },
                            );
                            setCsrf(r.csrf);
                            await me();
                          });
                        }}
                      >
                        <div>
                          <h3>Как вас зовут, исследователь?</h3>
                          <p>
                            Имя, достижения и открытые персонажи сохраняются в
                            этом браузере.
                          </p>
                        </div>
                        <input
                          aria-label="Имя исследователя"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          minLength={2}
                          maxLength={24}
                          required
                          placeholder="Ваш позывной"
                        />
                        <button disabled={busy}>Создать профиль</button>
                      </form>
                    )}
                    {room ? (
                      <section className="card lobby">
                        <div className="section-heading">
                          <div>
                            <small>EXPEDITION PARTY</small>
                            <h2>
                              Сбор команды{" "}
                              <span className="muted">
                                {room.members.length}/4
                              </span>
                            </h2>
                          </div>
                          <button
                            className="secondary"
                            onClick={() =>
                              void navigator.clipboard.writeText(room.id)
                            }
                          >
                            <Copy size={15} />
                            {room.id}
                          </button>
                        </div>
                        {room.members.map((member) => (
                          <div className="member" key={member.uid}>
                            <Sprite
                              pack={pack}
                              id={
                                pack.registry.get(
                                  "characters",
                                  member.characterId,
                                ).spriteId
                              }
                              size={48}
                            />
                            <strong>
                              {member.name}
                              {member.uid === room.ownerId ? " · лидер" : ""}
                            </strong>
                            <span>
                              {member.ready ? "Готов" : "Выбирает снаряжение"}
                            </span>
                            {profile?.uid === room.ownerId &&
                              member.uid !== profile.uid && (
                                <>
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      action(async () =>
                                        setRoom(
                                          await api(
                                            `/api/rooms/${room.id}/transfer`,
                                            "POST",
                                            { uid: member.uid },
                                          ),
                                        ),
                                      )
                                    }
                                  >
                                    Передать лидерство
                                  </button>
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      action(async () =>
                                        setRoom(
                                          await api(
                                            `/api/rooms/${room.id}/kick`,
                                            "POST",
                                            { uid: member.uid },
                                          ),
                                        ),
                                      )
                                    }
                                  >
                                    Удалить
                                  </button>
                                </>
                              )}
                          </div>
                        ))}
                        <div className="lobby-actions">
                          <select
                            aria-label="Персонаж для экспедиции"
                            value={character}
                            onChange={(e) => setCharacter(e.target.value)}
                          >
                            {pack.registry.all("characters").map((c) => (
                              <option
                                key={c.id}
                                disabled={
                                  !!c.unlockRuleId &&
                                  !profile?.unlocks.some(
                                    (u) => u.characterId === c.id,
                                  )
                                }
                                value={c.id}
                              >
                                {c.name}
                                {c.unlockRuleId &&
                                !profile?.unlocks.some(
                                  (u) => u.characterId === c.id,
                                )
                                  ? " · закрыт"
                                  : ""}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={busy}
                            onClick={() =>
                              action(async () =>
                                setRoom(
                                  await api(
                                    `/api/rooms/${room.id}/ready`,
                                    "POST",
                                    {
                                      ready: !room.members.find(
                                        (m) => m.uid === profile?.uid,
                                      )?.ready,
                                      characterId: character,
                                    },
                                  ),
                                ),
                              )
                            }
                          >
                            {room.members.find((m) => m.uid === profile?.uid)
                              ?.ready
                              ? "Отменить готовность"
                              : "Я готов"}
                          </button>
                          {profile?.uid === room.ownerId && (
                            <button
                              disabled={
                                busy || room.members.some((m) => !m.ready)
                              }
                              onClick={() =>
                                action(async () =>
                                  setRoom(
                                    await api(
                                      `/api/rooms/${room.id}/start`,
                                      "POST",
                                    ),
                                  ),
                                )
                              }
                            >
                              <Play size={16} />
                              Отправиться
                            </button>
                          )}
                          <button className="secondary" onClick={leave}>
                            Покинуть
                          </button>
                        </div>
                      </section>
                    ) : (
                      <div className="home-grid">
                        <section className="card join-card">
                          <div className="icon-box">
                            <Users size={22} />
                          </div>
                          <h3>В глубины вместе</h3>
                          <p>
                            Уже ждёт команда? Введите код комнаты, чтобы
                            присоединиться к экспедиции.
                          </p>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void action(async () =>
                                setRoom(
                                  await api(
                                    `/api/rooms/${encodeURIComponent(joinId)}/join`,
                                    "POST",
                                  ),
                                ),
                              );
                            }}
                          >
                            <input
                              aria-label="Код комнаты"
                              placeholder="Код комнаты"
                              value={joinId}
                              onChange={(e) => setJoinId(e.target.value.trim())}
                              required
                            />
                            <button
                              disabled={busy || !profile}
                              aria-label="Присоединиться"
                            >
                              <ArrowUpRight size={20} />
                            </button>
                          </form>
                        </section>
                        <section className="card loadout-card">
                          <div>
                            <small>YOUR EXPLORER</small>
                            <h3>
                              {pack.registry.get("characters", character).name}
                            </h3>
                            <p>
                              {
                                pack.registry.get("characters", character)
                                  .description
                              }
                            </p>
                            <button
                              className="text-button"
                              onClick={() => setTab("characters")}
                            >
                              Все персонажи <ChevronRight size={15} />
                            </button>
                          </div>
                          <Sprite
                            pack={pack}
                            id={
                              pack.registry.get("characters", character)
                                .spriteId
                            }
                            size={120}
                          />
                        </section>
                        <section className="card field-notes">
                          <small>FIELD NOTES / 001</small>
                          <h3>Сила в переменах.</h3>
                          <p>
                            Мутации меняют правила боя. Совмещайте эффекты и
                            собирайте свой стиль игры.
                          </p>
                          <div className="note-icons">
                            {pack.registry
                              .all("mutations")
                              .slice(0, 3)
                              .map((m) => (
                                <Sprite
                                  key={m.id}
                                  pack={pack}
                                  id={m.iconSpriteId}
                                  size={38}
                                />
                              ))}
                          </div>
                        </section>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {tab === "characters" && (
              <>
                <div className="section-heading">
                  <div>
                    <small>MEET THE EXPLORERS</small>
                    <h1>Кто отправится в глубины?</h1>
                  </div>
                </div>
                <div className="character-grid">
                  {pack.registry.all("characters").map((c) => {
                    const locked =
                      !!c.unlockRuleId &&
                      !profile?.unlocks.some((u) => u.characterId === c.id);
                    return (
                      <article
                        className={`card character-card ${locked ? "locked" : ""}`}
                        key={c.id}
                      >
                        <Sprite pack={pack} id={c.spriteId} size={180} />
                        <small>{locked ? "ЗАКРЫТ" : "ДОСТУПЕН"}</small>
                        <h2>{c.name}</h2>
                        <p>{c.description}</p>
                        <div className="stat-row">
                          <span>♥ {c.stats.maxHealth}</span>
                          <span>Скорость {c.stats.moveSpeed}</span>
                        </div>
                        {locked ? (
                          <p>
                            {pack.registry.get("unlocks", c.unlockRuleId!).name}
                          </p>
                        ) : (
                          <button
                            onClick={() => {
                              setCharacter(c.id);
                              setTab("play");
                            }}
                          >
                            Выбрать
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            )}
            {tab === "leaderboard" && (
              <>
                <small>THE DEEPEST JOURNEYS</small>
                <h1>Исследователи глубин</h1>
                <div className="card">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Исследователь</th>
                        <th>Глубина</th>
                        <th>Убийства</th>
                        <th>Поражения</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaders.map((p, i) => (
                        <tr key={p.uid}>
                          <td>{i + 1}</td>
                          <td>{p.name}</td>
                          <td>{p.maxDepth}</td>
                          <td>{p.kills}</td>
                          <td>{p.deaths}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!leaders.length && (
                    <p>Первую историю ещё предстоит написать.</p>
                  )}
                </div>
              </>
            )}
            {tab === "profile" && (
              <>
                <small>YOUR FIELD JOURNAL</small>
                <h1>{profile?.name ?? "Вы ещё не начали путь"}</h1>
                {profile && (
                  <>
                    <div className="profile-stats">
                      {[
                        ["Максимальная глубина", profile.maxDepth],
                        ["Побеждено врагов", profile.kills],
                        ["Поражения", profile.deaths],
                      ].map(([l, v]) => (
                        <div className="card" key={l}>
                          <strong>{v}</strong>
                          <span>{l}</span>
                        </div>
                      ))}
                    </div>
                    <section className="card">
                      <h3>История экспедиций</h3>
                      {runs.map((r) => (
                        <div className="history-row" key={r.run.id}>
                          <span>
                            {new Date(r.run.startedAt).toLocaleString("ru")}
                          </span>
                          <span>{r.run.status}</span>
                          <span>{r.countedKills} убийств</span>
                        </div>
                      ))}
                      {!runs.length && (
                        <p>
                          Здесь появятся ваши завершённые и сохранённые
                          экспедиции.
                        </p>
                      )}
                    </section>
                    <section className="card">
                      <h3>Начать прогресс заново</h3>
                      <p>
                        Открытые персонажи, UID и накопленная статистика
                        сохранятся. Введите RESET PROGRESS для сброса
                        прохождения.
                      </p>
                      <input
                        aria-label="Подтверждение сброса"
                        value={reset}
                        onChange={(e) => setReset(e.target.value)}
                        placeholder="RESET PROGRESS"
                      />
                      <button
                        className="secondary"
                        disabled={reset !== "RESET PROGRESS" || busy}
                        onClick={() =>
                          action(async () => {
                            await api("/api/users/me/progress/reset", "POST", {
                              confirmation: reset,
                              requestId: crypto.randomUUID(),
                            });
                            setReset("");
                            await me();
                          })
                        }
                      >
                        Сбросить прохождение
                      </button>
                    </section>
                  </>
                )}
              </>
            )}
            <footer>
              EMBERFALL <span>Одна жизнь. Тысяча способов измениться.</span>
              <span>CONTENT {pack.registry.version}</span>
            </footer>
          </div>
        )}
      </main>
      {settingsOpen && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Настройки"
          >
            <div className="section-heading">
              <h2>
                <AudioLines size={22} /> Настройки
              </h2>
              <button
                className="secondary"
                aria-label="Закрыть настройки"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            {!profile ? (
              <p>Создайте профиль, чтобы сохранять настройки.</p>
            ) : (
              <>
                {(
                  ["sfxVolume", "musicVolume", "screenShakeStrength"] as const
                ).map((key, i) => (
                  <label className="setting" key={key}>
                    {
                      [
                        "Громкость эффектов",
                        "Громкость музыки",
                        "Тряска камеры",
                      ][i]
                    }
                    <output>{profile.settings[key]}%</output>
                    <input
                      aria-label={key}
                      type="range"
                      min="0"
                      max="100"
                      value={profile.settings[key]}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          settings: {
                            ...profile.settings,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                      onPointerUp={() =>
                        action(() =>
                          setSettings({ [key]: profile.settings[key] }),
                        )
                      }
                      onKeyUp={() =>
                        action(() =>
                          setSettings({ [key]: profile.settings[key] }),
                        )
                      }
                    />
                  </label>
                ))}
                <label className="setting">
                  Частицы
                  <select
                    value={profile.settings.particleQuality}
                    onChange={(e) =>
                      action(() =>
                        setSettings({
                          particleQuality: e.target
                            .value as UserSettings["particleQuality"],
                        }),
                      )
                    }
                  >
                    {["low", "medium", "high"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label className="setting">
                  Уменьшить движение
                  <select
                    value={profile.settings.reducedMotion}
                    onChange={(e) =>
                      action(() =>
                        setSettings({
                          reducedMotion: e.target
                            .value as UserSettings["reducedMotion"],
                        }),
                      )
                    }
                  >
                    {["auto", "on", "off"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                {(["muteSfx", "muteMusic"] as const).map((key, i) => (
                  <label className="setting" key={key}>
                    {["Выключить эффекты", "Выключить музыку"][i]}
                    <input
                      type="checkbox"
                      checked={profile.settings[key]}
                      onChange={(e) =>
                        action(() => setSettings({ [key]: e.target.checked }))
                      }
                    />
                  </label>
                ))}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
