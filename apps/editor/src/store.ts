import { create } from "zustand";
import type {
  Content,
  CollectionName,
  AnyDefinition,
} from "../../../packages/content-schemas/src/definitions";
import {
  validateContent,
  type ValidationIssue,
} from "../../../packages/content-schemas/src/validate";
import { api } from "../../../packages/editor-components/src/api";
export type Draft = {
  id: string;
  name: string;
  revision: number;
  content: Content;
  ui: Record<string, unknown>;
};
type Store = {
  draft?: Draft;
  selection?: { collection: CollectionName; id: string };
  past: Content[];
  future: Content[];
  dirty: boolean;
  saving: boolean;
  savedAt: string;
  error: string;
  issues: ValidationIssue[];
  changeId: number;
  previewVersion: number;
  load: (draft: Draft) => void;
  select: (collection: CollectionName, id: string) => void;
  edit: (collection: CollectionName, id: string, value: AnyDefinition) => void;
  replace: (content: Content) => void;
  remove: (collection: CollectionName, id: string) => void;
  ui: (key: string, value: unknown) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  validate: () => void;
};
export const useStudio = create<Store>((set, get) => ({
  past: [],
  future: [],
  dirty: false,
  saving: false,
  savedAt: "",
  error: "",
  issues: [],
  changeId: 0,
  previewVersion: 0,
  load: (draft) =>
    set({
      draft,
      dirty: false,
      past: [],
      future: [],
      issues: validateContent(draft.content),
      savedAt: new Date().toLocaleTimeString(),
      error: "",
      selection: {
        collection: "weapons",
        id: draft.content.weapons.items[0]?.id ?? "",
      },
    }),
  select: (collection, id) => set({ selection: { collection, id } }),
  replace: (content) => {
    const state = get();
    if (!state.draft) return;
    set({
      draft: { ...state.draft, content },
      past: [...state.past.slice(-49), state.draft.content],
      future: [],
      dirty: true,
      changeId: state.changeId + 1,
      previewVersion: state.previewVersion + 1,
    });
  },
  edit: (collection, id, value) => {
    const state = get();
    if (!state.draft) return;
    const content = structuredClone(state.draft.content);
    const rows = content[collection].items as AnyDefinition[];
    const index = rows.findIndex((x) => x.id === id);
    if (index < 0) rows.push(value);
    else rows[index] = value;
    get().replace(content);
    if (id !== value.id) set({ selection: { collection, id: value.id } });
  },
  remove: (collection, id) => {
    const d = get().draft;
    if (!d) return;
    const c = structuredClone(d.content);
    (c[collection].items as AnyDefinition[]) = (
      c[collection].items as AnyDefinition[]
    ).filter((x) => x.id !== id);
    get().replace(c);
    set({ selection: undefined });
  },
  ui: (key, value) => {
    const state = get();
    if (state.draft)
      set({
        draft: { ...state.draft, ui: { ...state.draft.ui, [key]: value } },
        dirty: true,
        changeId: state.changeId + 1,
      });
  },
  undo: () => {
    const s = get();
    if (!s.past.length || !s.draft) return;
    set({
      draft: { ...s.draft, content: s.past.at(-1)! },
      past: s.past.slice(0, -1),
      future: [s.draft.content, ...s.future],
      dirty: true,
      changeId: s.changeId + 1,
      previewVersion: s.previewVersion + 1,
    });
  },
  redo: () => {
    const s = get();
    if (!s.future.length || !s.draft) return;
    set({
      draft: { ...s.draft, content: s.future[0] },
      past: [...s.past, s.draft.content],
      future: s.future.slice(1),
      dirty: true,
      changeId: s.changeId + 1,
      previewVersion: s.previewVersion + 1,
    });
  },
  save: async () => {
    const s = get();
    if (!s.draft || s.saving || !s.dirty) return;
    set({ saving: true, error: "" });
    try {
      const result = await api<{ revision: number; issues: ValidationIssue[] }>(
        `/api/editor/projects/${s.draft.id}`,
        "PUT",
        {
          revision: s.draft.revision,
          name: s.draft.name,
          content: s.draft.content,
          ui: s.draft.ui,
        },
      );
      const current = get();
      if (current.draft?.id === s.draft.id)
        set({
          draft: { ...current.draft, revision: result.revision },
          dirty: current.changeId !== s.changeId,
          savedAt: new Date().toLocaleTimeString(),
          issues: result.issues,
        });
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    } finally {
      set({ saving: false });
    }
  },
  validate: () => {
    const d = get().draft;
    if (d) set({ issues: validateContent(d.content) });
  },
}));
export const GROUPS: { name: string; collections: CollectionName[] }[] = [
  { name: "Персонажи", collections: ["characters"] },
  {
    name: "Оружие",
    collections: ["weapons", "projectiles", "beams", "damageTypes"],
  },
  {
    name: "Враги и AI",
    collections: ["enemies", "behaviors", "attackPatterns"],
  },
  { name: "Боссы", collections: ["bosses"] },
  { name: "Окружение", collections: ["props", "pickups"] },
  { name: "Мутации", collections: ["mutations", "effects", "statuses"] },
  { name: "Event Logic", collections: ["graphs", "eventBindings"] },
  { name: "Анимация", collections: ["animations"] },
  { name: "Спрайты", collections: ["sprites"] },
  { name: "Звук и музыка", collections: ["sounds", "music"] },
  { name: "Частицы", collections: ["particles", "cameraEffects"] },
  { name: "Сундуки и лут", collections: ["chests", "lootTables", "dropRules"] },
  { name: "Биомы и тайлы", collections: ["biomes", "tilePalettes"] },
  { name: "Карты и комнаты", collections: ["tilemaps", "roomTemplates"] },
  {
    name: "Генерация уровней",
    collections: [
      "levels",
      "generationRules",
      "enemySpawnTables",
      "decorationSpawnTables",
      "chestSpawnTables",
    ],
  },
  { name: "Кампания", collections: ["campaigns"] },
  { name: "Разблокировки", collections: ["unlocks"] },
];
