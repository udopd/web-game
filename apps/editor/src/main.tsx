import React, {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  Box,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileCheck,
  FolderOpen,
  GitBranch,
  Layers,
  Leaf,
  LogOut,
  Maximize2,
  Play,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  setCsrf,
  download,
} from "../../../packages/editor-components/src/api";
import {
  definitions,
  type AnyDefinition,
  type CollectionName,
} from "../../../packages/content-schemas/src/definitions";
import { useStudio, GROUPS, type Draft } from "./store";
import { defaultValue, Inspector } from "./fields";
import { Workbench, AssetPreview, assetUrl, SpritePreview } from "./preview";
import { GraphStudio } from "./graph";
import { TilemapStudio } from "./tilemap";
import "./style.css";
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="error">
        Ошибка панели: {this.state.error}
        <button onClick={() => this.setState({ error: "" })}>Повторить</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const icons: Record<string, typeof Box> = {
  Library: FolderOpen,
  Inspector: Settings2,
  Preview: Play,
  Assets: Layers,
  Graph: GitBranch,
  Map: Layers,
  Validation: FileCheck,
  Media: Upload,
  Versions: GitBranch,
  Help: Box,
};
const titles: Record<string, string> = {
  Library: "Библиотека",
  Inspector: "Инспектор",
  Preview: "Симуляция",
  Assets: "Просмотр ресурса",
  Graph: "Event & Campaign Graph",
  Map: "Level Studio",
  Validation: "Проверка",
  Media: "Asset Library",
  Versions: "Версии",
  Help: "Справка",
};
function Library() {
  const { draft, select, selection, edit } = useStudio();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState("Оружие");
  return (
    <div className="library panel-scroll">
      <div className="search">
        <Search size={14} />
        <input
          aria-label="Поиск контента"
          placeholder="Название или ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {GROUPS.map((group) => (
        <div key={group.name} className="library-group">
          <button
            className="group-title"
            onClick={() => setOpen(open === group.name ? "" : group.name)}
          >
            <ChevronDown
              size={12}
              className={open === group.name ? "" : "closed"}
            />
            {group.name}
            <span>
              {group.collections.reduce(
                (n, k) => n + (draft?.content[k].items.length ?? 0),
                0,
              )}
            </span>
          </button>
          {(open === group.name || query) &&
            group.collections.map((collection) => (
              <div key={collection}>
                <div className="collection-title">
                  <small>{collection}</small>
                  <button
                    className="icon"
                    title={`Создать ${collection}`}
                    aria-label={`Создать ${collection}`}
                    onClick={() => {
                      const value = defaultValue(
                        definitions[collection],
                      ) as AnyDefinition;
                      value.id = `new-${Date.now().toString(36)}`;
                      value.name = "Новый объект";
                      edit(collection, value.id, value);
                      select(collection, value.id);
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                {draft?.content[collection].items
                  .filter((i) =>
                    `${i.name} ${i.id}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((i) => (
                    <button
                      key={i.id}
                      className={`library-item ${selection?.id === i.id && selection.collection === collection ? "selected" : ""}`}
                      onClick={() => select(collection, i.id)}
                    >
                      <Box size={12} />
                      <span>
                        {i.name}
                        <small>{i.id}</small>
                      </span>
                    </button>
                  ))}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
function Validation() {
  const { issues, validate, select, draft } = useStudio();
  return (
    <div className="panel-scroll validation">
      <div className="toolbar">
        <button onClick={validate}>
          <FileCheck size={14} />
          Проверить черновик
        </button>
        <strong>
          {issues.length ? `${issues.length} ошибок` : "Ошибок не найдено"}
        </strong>
      </div>
      {!issues.length && (
        <div className="empty">
          <CheckCircle2 size={32} />
          <h3>Структура контента корректна</h3>
          <p>
            Проверены схемы, ссылки, графы, карты и версии расширений.
            Сохранение и публикация выполняются отдельно.
          </p>
        </div>
      )}
      {issues.slice(0, 200).map((issue, i) => (
        <button
          className="issue"
          key={i}
          onClick={() => {
            for (const [key, col] of Object.entries(draft?.content ?? {}))
              for (const item of col.items)
                if (issue.path.includes(`:${item.id}`)) {
                  select(key as CollectionName, item.id);
                  return;
                }
          }}
        >
          <strong>{issue.path}</strong>
          <span>{issue.message}</span>
        </button>
      ))}
    </div>
  );
}
type Asset = {
  key: string;
  name: string;
  mime: string;
  hash: string;
  width?: number;
  height?: number;
  duration?: number;
  size: number;
};
function Media() {
  const [assets, setAssets] = useState<Asset[]>([]),
    [queue, setQueue] = useState<{ name: string; status: string }[]>([]),
    [error, setError] = useState("");
  const { edit, select } = useStudio();
  const refresh = () => api<Asset[]>("/api/editor/assets").then(setAssets);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      setQueue((q) => [...q, { name: file.name, status: "Загрузка…" }]);
      try {
        const body = new FormData();
        body.append("file", file);
        await api("/api/editor/assets", "POST", body);
        setQueue((q) =>
          q.map((x) => (x.name === file.name ? { ...x, status: "Готово" } : x)),
        );
      } catch (e) {
        setQueue((q) =>
          q.map((x) =>
            x.name === file.name ? { ...x, status: (e as Error).message } : x,
          ),
        );
      }
    }
    await refresh();
  };
  const create = (asset: Asset) => {
    const collection = asset.mime.startsWith("image/") ? "sprites" : "sounds",
      item = defaultValue(definitions[collection]);
    item.id = `asset-${asset.hash.slice(0, 12)}`;
    item.name = asset.name;
    item.source = asset.key;
    if (collection === "sprites") {
      item.frame = { x: 0, y: 0, width: asset.width, height: asset.height };
      item.pivot = { x: asset.width! / 2, y: asset.height! / 2 };
      item.renderScale = 0.1;
      item.layer = "characters";
    } else {
      item.pitch = { min: 1, max: 1 };
      item.spatial = {
        enabled: false,
        referenceDistance: 160,
        maxDistance: 900,
      };
    }
    edit(collection, item.id, item);
    select(collection, item.id);
  };
  return (
    <div
      className="panel-scroll media"
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add("dragover");
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove("dragover")}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("dragover");
        void upload(e.dataTransfer.files);
      }}
    >
      <label className="dropzone">
        <Upload size={28} />
        <strong>Перетащите ресурсы сюда</strong>
        <span>PNG · WebP · WAV · OGG · MP3 · до 16 MB</span>
        <input
          type="file"
          multiple
          accept=".png,.webp,.wav,.ogg,.mp3"
          onChange={(e) => void upload(e.target.files)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      {queue.map((q, i) => (
        <div className="queue-item" key={i}>
          <span>{q.name}</span>
          <span>{q.status}</span>
        </div>
      ))}
      <div className="media-grid">
        {assets.map((asset) => (
          <article key={asset.key}>
            {asset.mime.startsWith("image/") ? (
              <img src={assetUrl(asset.key)} loading="lazy" alt={asset.name} />
            ) : (
              <audio src={assetUrl(asset.key)} controls preload="none" />
            )}
            <strong title={asset.name}>{asset.name}</strong>
            <small>
              {asset.width ? `${asset.width} × ${asset.height}` : asset.mime} ·{" "}
              {Math.round(asset.size / 1024)} KB
            </small>
            <button onClick={() => create(asset)}>Создать определение</button>
          </article>
        ))}
      </div>
    </div>
  );
}
function Versions() {
  const [versions, setVersions] = useState<
      { version: string; hash: string; createdAt: string }[]
    >([]),
    [active, setActive] = useState(""),
    [error, setError] = useState("");
  const refresh = async () => {
    setVersions(await api("/api/editor/versions"));
    setActive((await api<{ version: string }>("/api/content/current")).version);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <div className="panel-scroll versions">
      <h3>Опубликованные пакеты</h3>
      <p className="help">
        Каждый пакет неизменяем. Переключение влияет на новые комнаты. Текущие
        забеги сохраняют свою версию.
      </p>
      {error && <p className="error">{error}</p>}
      {versions.map((v) => (
        <article key={v.version}>
          <strong>
            {v.version} {v.version === active ? "· АКТИВНА" : ""}
          </strong>
          <small>{new Date(v.createdAt).toLocaleString()}</small>
          <code>{v.hash.slice(0, 20)}…</code>
          <button
            disabled={v.version === active}
            onClick={async () => {
              try {
                await api("/api/editor/rollback", "POST", {
                  version: v.version,
                });
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Сделать активной
          </button>
        </article>
      ))}
    </div>
  );
}
function Help() {
  const selection = useStudio((s) => s.selection);
  return (
    <div className="panel-scroll help-panel">
      <small>CONTEXT HELP</small>
      <h2>{selection?.collection ?? "Content Studio"}</h2>
      <p>
        Выберите объект в библиотеке. Инспектор показывает его поля и ссылки.
        Для теста нажмите «Применить» в симуляции.
      </p>
      <h3>Состояния контента</h3>
      <p>
        Черновик сохраняется автоматически после изменения. «Проверить»
        проверяет текущую структуру. «Опубликовать» создаёт неизменяемую версию
        для новых игровых комнат.
      </p>
      <h3>Единицы</h3>
      <p>
        Симуляция: 30 тиков в секунду. Урон и движение считаются сервером.
        Анимация, звук и частицы используют миллисекунды. Координаты карты —
        мировые пиксели.
      </p>
      <h3>Горячие клавиши</h3>
      <p>
        Ctrl+S — сохранить
        <br />
        Ctrl+Z / Ctrl+Shift+Z — отменить / повторить
        <br />В графе Delete удаляет выбранные узлы.
        <br />
        На полигоне WASD — движение, мышь — прицел, ЛКМ — огонь, E —
        взаимодействие.
      </p>
      <h3>Панели</h3>
      <p>
        Перетаскивайте вкладки для перестановки. Кнопка «Отделить» выносит
        активную панель в плавающее окно. «Развернуть» увеличивает её на рабочую
        область. Схема панелей хранится в черновике.
      </p>
      <h3>Доверенные расширения</h3>
      <p>
        Custom mutations устанавливаются через TypeScript SDK и сборку сервера.
        Загрузка ZIP не исполняет код. Параметры расширений доступны у эффектов.
      </p>
    </div>
  );
}
const panels: Record<string, () => React.ReactElement | null> = {
  Library,
  Inspector,
  Preview: Workbench,
  Assets: AssetPreview,
  Graph: GraphStudio,
  Map: TilemapStudio,
  Validation,
  Media,
  Versions,
  Help,
};
function Panel(props: IDockviewPanelProps) {
  const View = panels[props.params.type];
  return (
    <Boundary>
      {View ? <View /> : <div className="empty">Неизвестная панель</div>}
    </Boundary>
  );
}
const components = { panel: Panel };
function App() {
  const {
    draft,
    dirty,
    saving,
    error,
    savedAt,
    issues,
    past,
    future,
    save,
    load,
    undo,
    redo,
    changeId,
  } = useStudio();
  const [projects, setProjects] = useState<
      { id: string; name: string; revision: number }[]
    >([]),
    [message, setMessage] = useState(""),
    [publish, setPublish] = useState(false),
    [version, setVersion] = useState("1.0.1"),
    [busy, setBusy] = useState(false),
    [preset, setPreset] = useState("combat");
  const dock = useRef<DockviewApi | undefined>(undefined);
  const restoring = useRef(false),
    file = useRef<HTMLInputElement>(null);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void action(async () => {
      const session = await api<{ csrf: string }>("/api/editor/session");
      setCsrf(session.csrf);
      const list = await api<typeof projects>("/api/editor/projects");
      setProjects(list);
      if (list[0]) load(await api<Draft>(`/api/editor/projects/${list[0].id}`));
    });
  }, []);
  useEffect(() => {
    if (!dirty || saving || error) return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [changeId, saving, error]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "s") {
        e.preventDefault();
        void save().catch(() => {});
      }
      if (
        e.key === "z" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    const before = (e: BeforeUnloadEvent) => {
      if (useStudio.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", before);
    };
  }, []);
  const add = (type: string) => {
    const api = dock.current;
    if (!api) return;
    const existing = api.getPanel(type);
    if (existing) {
      existing.api.setActive();
      return;
    }
    api.addPanel({
      id: type,
      component: "panel",
      title: titles[type],
      params: { type },
    });
  };
  const layout = (mode: string) => {
    const api = dock.current;
    if (!api) return;
    restoring.current = true;
    api.clear();
    api.addPanel({
      id: "Library",
      component: "panel",
      title: titles.Library,
      params: { type: "Library" },
      initialWidth: 240,
    });
    const center =
      mode === "level"
        ? "Map"
        : mode === "logic"
          ? "Graph"
          : mode === "art"
            ? "Assets"
            : "Preview";
    api.addPanel({
      id: center,
      component: "panel",
      title: titles[center],
      params: { type: center },
      position: { referencePanel: "Library", direction: "right" },
    });
    api.addPanel({
      id: "Inspector",
      component: "panel",
      title: titles.Inspector,
      params: { type: "Inspector" },
      position: { referencePanel: center, direction: "right" },
      initialWidth: 310,
    });
    api.addPanel({
      id: "Validation",
      component: "panel",
      title: titles.Validation,
      params: { type: "Validation" },
      position: { referencePanel: center, direction: "below" },
      initialHeight: 150,
    });
    api.getPanel('Library')?.api.setSize({width:240});
    api.getPanel('Inspector')?.api.setSize({width:310});
    restoring.current = false;
    useStudio.getState().ui("layout", api.toJSON());
  };
  const ready = (e: DockviewReadyEvent) => {
    dock.current = e.api;
    const saved = useStudio.getState().draft?.ui.layout;
    if (saved) {
      try {
        restoring.current = true;
        e.api.fromJSON(saved as any);
      } catch {
        layout("combat");
      } finally {
        restoring.current = false;
      }
    } else layout("combat");
    let timer: ReturnType<typeof setTimeout>;
    e.api.onDidLayoutChange(() => {
      if (restoring.current) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => useStudio.getState().ui("layout", e.api.toJSON()),
        500,
      );
    });
  };
  return (
    <div className="studio">
      <header className="studio-header">
        <a className="studio-brand" href="/">
          <span>
            <Leaf size={18} />
          </span>
          EMBERFALL<small>CONTENT STUDIO</small>
        </a>
        <div className="project-picker">
          <FolderOpen size={15} />
          <select
            aria-label="Проект"
            value={draft?.id ?? ""}
            onChange={(e) =>
              void action(async () => {
                await save();
                load(await api(`/api/editor/projects/${e.target.value}`));
              })
            }
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="icon"
            aria-label="Новый проект"
            onClick={() => {
              const name = prompt("Название нового проекта");
              if (name)
                void action(async () => {
                  const d = await api<Draft>("/api/editor/projects", "POST", {
                    name,
                  });
                  setProjects((p) => [d, ...p]);
                  load(d);
                });
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="header-actions">
          <span className={`save-status ${dirty ? "dirty" : ""}`}>
            <i />
            {saving
              ? "Сохранение…"
              : dirty
                ? "Есть изменения"
                : `Сохранено ${savedAt}`}
          </span>
          <button
            title="Отменить · Ctrl+Z"
            disabled={!past.length}
            onClick={undo}
          >
            <Undo2 size={15} />
          </button>
          <button
            title="Повторить · Ctrl+Shift+Z"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 size={15} />
          </button>
          <button onClick={() => void action(save)} disabled={saving || !dirty}>
            <Save size={14} />
            Сохранить
          </button>
          <button className="primary" onClick={() => setPublish(true)}>
            <Upload size={14} />
            Опубликовать
          </button>
          <button
            title="Выйти из редактора"
            onClick={() =>
              void action(async () => {
                await save();
                await api("/api/editor/auth/logout", "POST");
                location.href = "/editor/login";
              })
            }
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>
      <div className="workspace-toolbar">
        <div className="breadcrumb">
          Workspace <span>/</span> {draft?.name ?? "Загрузка…"}{" "}
          <small>rev {draft?.revision ?? "—"}</small>
        </div>
        <select
          aria-label="Макет редактора"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value);
            layout(e.target.value);
          }}
        >
          <option value="combat">Combat design</option>
          <option value="art">Art & animation</option>
          <option value="level">Level design</option>
          <option value="logic">Logic & campaign</option>
        </select>
        <button
          onClick={() => {
            const panel = dock.current?.activePanel;
            if (panel)
              dock.current?.addFloatingGroup(panel, {
                width: 600,
                height: 420,
              });
          }}
        >
          <ExternalLink size={13} />
          Отделить
        </button>
        <button onClick={() => {const panel=dock.current?.activePanel?.api;if(panel?.isMaximized())panel.exitMaximized();else panel?.maximize();}}>
          <Maximize2 size={13} />
          Развернуть
        </button>
        <button
          onClick={() =>
            void action(async () => {
              await save();
              download(
                await api<Blob>(
                  `/api/editor/projects/${draft!.id}/export`,
                  "POST",
                ),
                `${draft!.name}.zip`,
              );
            })
          }
        >
          <Download size={13} />
          Export ZIP
        </button>
        <button onClick={() => file.current?.click()}>
          <Upload size={13} />
          Import ZIP
        </button>
        <input
          hidden
          ref={file}
          type="file"
          accept=".zip"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected)
              void action(async () => {
                await save();
                const body = new FormData();
                body.append("file", selected);
                const response = await api<{
                  content: Draft["content"];
                  revision: number;
                }>(`/api/editor/projects/${draft!.id}/import`, "POST", body);
                load({ ...draft!, ...response });
                setMessage("Пакет импортирован и проверен");
              });
          }}
        />
      </div>
      {(message || error) && (
        <div className="banner" role="alert">
          {message || error}
          <button
            className="icon"
            aria-label="Закрыть уведомление"
            onClick={() => {
              setMessage("");
              useStudio.setState({ error: "" });
            }}
          >
            <X size={13} />
          </button>
          {error && (
            <button
              onClick={() =>
                draft &&
                download(
                  new Blob([JSON.stringify(draft)], {
                    type: "application/json",
                  }),
                  "local-draft-recovery.json",
                )
              }
            >
              Скачать локальные изменения
            </button>
          )}
        </div>
      )}
      <div className="studio-body">
        <nav className="tool-rail">
          {Object.keys(panels).map((type) => {
            const Icon = icons[type];
            return (
              <button
                key={type}
                title={titles[type]}
                aria-label={`Открыть ${titles[type]}`}
                onClick={() => add(type)}
              >
                <Icon size={19} />
                <small>{titles[type].split(" ")[0]}</small>
              </button>
            );
          })}
        </nav>
        <div className="dock-area">
          {draft ? (
            <DockviewReact
              key={draft.id}
              components={components}
              onReady={ready}
              className="dockview-theme-abyss"
            />
          ) : (
            <div className="empty">Загрузка проекта…</div>
          )}
        </div>
      </div>
      <footer className="studio-footer">
        <span>
          <i /> DRAFT · {draft?.name ?? "—"}
        </span>
        <button
          onClick={() => {
            useStudio.getState().validate();
            add("Validation");
          }}
          className={issues.length ? "danger" : ""}
        >
          {issues.length ? `${issues.length} ошибок` : "Проверка: нет ошибок"}
        </button>
        <span>30 Hz · shared simulation</span>
        <span>Ctrl+S сохранить · Ctrl+Z отменить</span>
      </footer>
      {publish && (
        <div className="modal-backdrop">
          <section
            className="dialog"
            role="dialog"
            aria-label="Публикация контента"
          >
            <small>IMMUTABLE CONTENT PACK</small>
            <h2>Опубликовать версию</h2>
            <p>
              Создаётся новый пакет с SHA-256 для каждого файла. Новые комнаты
              будут использовать эту версию. Уже начатые забеги продолжат
              использовать свою.
            </p>
            <label className="field">
              Версия
              <input
                aria-label="Версия публикации"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                pattern="\d+\.\d+\.\d+"
              />
            </label>
            <div className="dialog-actions">
              <button onClick={() => setPublish(false)}>Отмена</button>
              <button
                className="primary"
                disabled={busy || !/^\d+\.\d+\.\d+$/.test(version)}
                onClick={() =>
                  void action(async () => {
                    useStudio.getState().validate();
                    if (useStudio.getState().issues.length)
                      throw new Error("Исправьте ошибки перед публикацией");
                    await save();
                    const current = useStudio.getState().draft!;
                    await api(
                      `/api/editor/projects/${current.id}/publish`,
                      "POST",
                      { revision: current.revision, version },
                    );
                    setPublish(false);
                    setMessage(`Версия ${version} опубликована`);
                  })
                }
              >
                Проверить и опубликовать
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
