import React, { useState } from "react";
import type { TSchema } from "@sinclair/typebox";
import { Plus, X } from "lucide-react";
import {
  definitions,
  type CollectionName,
} from "../../../packages/content-schemas/src/definitions";
import { useStudio } from "./store";
import {extensionCatalog} from '../../../packages/mutation-extensions/src/generated/catalog';
const labels: Record<string, string> = {
  id: "ID",
  name: "Название",
  tags: "Теги",
  source: "Файл ресурса",
  damage: "Урон",
  speed: "Скорость",
  cooldownTicks: "Перезарядка между атаками · тики",
  reloadTicks: "Перезарядка магазина · тики",
  lifetimeTicks: "Время жизни · тики",
  spriteId: "Спрайт",
  animationSet: "Состояния анимации",
  stats: "Характеристики",
  maxHealth: "Здоровье",
  moveSpeed: "Скорость движения",
  collision: "Коллизия",
  baseChance: "Базовый шанс",
  difficultyRating: "Сложность",
  conditions: "Условия",
  actions: "Действия",
  event: "Событие",
  sourceId: "Источник",
  renderScale: "Масштаб",
  pivot: "Точка опоры",
  frame: "Область кадра",
  durationMs: "Длительность · мс",
  min: "Минимум",
  max: "Максимум",
  weight: "Вес",
  probability: "Вероятность",
  enabled: "Включено",
  radius: "Радиус",
  class: "Класс",
  policy: "Распределение наград",
  generationMode: "Способ генерации",
  frames: "Кадры",
  description: "Описание",
  damageTypeId: "Тип урона",
  levelId: "Уровень",
  biomeId: "Биом",
};
export function defaultValue(schema: TSchema): any {
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf) return defaultValue(schema.anyOf[0]);
  if (schema["x-collection"])
    return (
      useStudio.getState().draft?.content[
        schema["x-collection"] as CollectionName
      ].items[0]?.id ?? ""
    );
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([k]) => schema.required?.includes(k))
        .map(([k, v]) => [k, defaultValue(v as TSchema)]),
    );
  if (schema.type === "array")
    return Array.from({ length: schema.minItems ?? 0 }, () =>
      defaultValue(schema.items),
    );
  if (schema.type === "boolean") return false;
  if (schema.type === "integer" || schema.type === "number")
    return Math.max(0, schema.minimum ?? 0);
  if (schema.type === "null") return null;
  return "";
}
export function Field({
  schema,
  value,
  onChange,
  path,
  label,
  depth = 0,
}: {
  schema: TSchema;
  value: any;
  onChange: (value: any) => void;
  path: string;
  label: string;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const draft = useStudio((s) => s.draft);
  const title = labels[label] ?? label;
  if (schema.anyOf) {
    const branches = schema.anyOf as TSchema[];
    if (branches.every((b) => b.const !== undefined || b.type === "null"))
      return (
        <label className="field" title={path}>
          {title}
          <select
            aria-label={path}
            value={value === null ? "__null" : String(value ?? "")}
            onChange={(e) =>
              onChange(e.target.value === "__null" ? null : e.target.value)
            }
          >
            {branches.map((b, i) => (
              <option key={i} value={b.type === "null" ? "__null" : b.const}>
                {b.type === "null" ? "Нет" : b.const}
              </option>
            ))}
          </select>
        </label>
      );
    const reference = branches.find((b) => b["x-collection"]);
    if (reference)
      return (
        <Field
          schema={reference}
          value={value ?? ""}
          onChange={onChange}
          path={path}
          label={label}
          depth={depth}
        />
      );
    const index = Math.max(
      0,
      branches.findIndex(
        (b) =>
          (b.properties?.type?.const === value?.type &&
            b.properties?.type?.const !== undefined) ||
          b.type === typeof value,
      ),
    );
    const selected = branches[index];
    return (
      <div className="union">
        <label className="field">
          {title}
          <select
            aria-label={`${path}.variant`}
            value={index}
            onChange={(e) =>
              onChange(defaultValue(branches[Number(e.target.value)]))
            }
          >
            {branches.map((b, i) => (
              <option key={i} value={i}>
                {b.properties?.type?.const ?? b.type ?? i}
              </option>
            ))}
          </select>
        </label>
        <Field
          schema={selected}
          value={value}
          onChange={onChange}
          path={path}
          label={label}
          depth={depth}
        />
      </div>
    );
  }
  if (schema.type === "object") {
    const props = Object.entries(schema.properties ?? {});
    if (!props.length)
      return (
        <JsonField value={value ?? {}} onChange={onChange} label={title} />
      );
    return (
      <fieldset className="object-field">
        <legend>
          <button className="disclosure" onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"} {title}
          </button>
        </legend>
        {expanded &&
          props.map(([key, sub]) => {
            const required = schema.required?.includes(key),
              exists = value?.[key] !== undefined;
            return (
              <div key={key}>
                {!required && (
                  <label className="optional">
                    <input
                      type="checkbox"
                      checked={exists}
                      onChange={(e) => {
                        const next = { ...value };
                        if (e.target.checked)
                          next[key] = defaultValue(sub as TSchema);
                        else delete next[key];
                        onChange(next);
                      }}
                    />{" "}
                    {labels[key] ?? key}
                  </label>
                )}
                {(exists || required) && (
                  <Field
                    schema={sub as TSchema}
                    value={value?.[key]}
                    onChange={(v) => onChange({ ...value, [key]: v })}
                    path={`${path}.${key}`}
                    label={key}
                    depth={depth + 1}
                  />
                )}
              </div>
            );
          })}
      </fieldset>
    );
  }
  if (schema.type === "array")
    return (
      <fieldset className="array-field">
        <legend>
          <button className="disclosure" onClick={() => setExpanded(!expanded)}>
            {expanded ? "▾" : "▸"} {title} <span>{value?.length ?? 0}</span>
          </button>
        </legend>
        {expanded && (
          <>
            {(value ?? []).map((v: any, i: number) => (
              <div className="array-row" key={i}>
                <div className="array-row-head">
                  <small>{i + 1}</small>
                  <button
                    className="icon"
                    aria-label={`Переместить ${path}[${i}] вверх`}
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...value];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      onChange(next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className="icon"
                    aria-label={`Удалить ${path}[${i}]`}
                    onClick={() =>
                      onChange(value.filter((_: any, k: number) => i !== k))
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
                <Field
                  schema={schema.items}
                  value={v}
                  onChange={(next) =>
                    onChange(
                      value.map((item: any, k: number) =>
                        k === i ? next : item,
                      ),
                    )
                  }
                  path={`${path}[${i}]`}
                  label={`${i + 1}`}
                  depth={depth + 1}
                />
              </div>
            ))}
            <button
              className="small"
              disabled={(value?.length ?? 0) >= (schema.maxItems ?? 10000)}
              onClick={() =>
                onChange([...(value ?? []), defaultValue(schema.items)])
              }
            >
              <Plus size={12} />
              Добавить
            </button>
          </>
        )}
      </fieldset>
    );
  if (schema["x-collection"])
    return (
      <label className="field" title={path}>
        {title}
        <select
          aria-label={path}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Выберите…</option>
          {draft?.content[schema["x-collection"] as CollectionName]?.items.map(
            (d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.id}
              </option>
            ),
          )}
        </select>
      </label>
    );
  if (schema.type === "boolean")
    return (
      <label className="field checkbox" title={path}>
        {title}
        <input
          aria-label={path}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    );
  if (schema.type === "number" || schema.type === "integer")
    return (
      <label
        className="field"
        title={`${path} · ${schema.minimum ?? "−∞"} … ${schema.maximum ?? "∞"}`}
      >
        {title}
        <input
          aria-label={path}
          type="number"
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === "integer" ? 1 : "any"}
          value={value ?? 0}
          onChange={(e) => {
            if (e.target.value !== "") onChange(Number(e.target.value));
          }}
        />
      </label>
    );
  if (schema.type === "null") return null;
  return (
    <label className="field" title={path}>
      {title}
      <input
        aria-label={path}
        type={String(value).match(/^#[0-9a-f]{6}$/i) ? "color" : "text"}
        value={value ?? schema.const ?? ""}
        readOnly={schema.const !== undefined}
        maxLength={schema.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function JsonField({
  value,
  onChange,
  label,
}: {
  value: any;
  onChange: (v: any) => void;
  label: string;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  return (
    <label className="json-field">
      {label}
      <textarea
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError("");
          } catch {
            setError("Некорректный JSON");
          }
        }}
      />
      {error && <small className="danger">{error}</small>}
    </label>
  );
}
export function Inspector() {
  const { draft, selection, edit, remove } = useStudio();
  if (!draft || !selection)
    return <div className="empty">Выберите объект в библиотеке</div>;
  const item = draft.content[selection.collection].items.find(
    (d) => d.id === selection.id,
  );
  if (!item) return <div className="empty">Объект не найден</div>;
  const schema=structuredClone(definitions[selection.collection]);
  if(selection.collection==='effects'&&'extensionId'in item){const extension=extensionCatalog.find(x=>x.meta.id===item.extensionId);if(extension)(schema.properties as Record<string,TSchema>).params=extension.params as unknown as TSchema;}
  return (
    <div className="inspector panel-scroll">
      <div className="object-heading">
        <small>{selection.collection}</small>
        <h2>{item.name}</h2>
        <code>{item.id}</code>
      </div>
      <Field
        key={`${selection.collection}:${selection.id}`}
        schema={schema}
        value={item}
        onChange={(v) => edit(selection.collection, selection.id, v)}
        path={`${selection.collection}.${item.id}`}
        label="Параметры"
      />
      <div className="inspector-actions">
        <button
          onClick={() =>
            edit(selection.collection, `${item.id}.copy`, {
              ...structuredClone(item),
              id: `${item.id}.copy-${Date.now().toString(36)}`,
              name: `${item.name} · копия`,
            })
          }
        >
          Дублировать
        </button>
        <button
          className="danger"
          onClick={() => {
            if (
              confirm(
                `Удалить ${item.name}? Ссылки будут отмечены валидатором. Отменить можно через Ctrl+Z.`,
              )
            )
              remove(selection.collection, item.id);
          }}
        >
          Удалить
        </button>
      </div>
    </div>
  );
}
