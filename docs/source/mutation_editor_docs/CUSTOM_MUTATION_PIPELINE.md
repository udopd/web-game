# CUSTOM_MUTATION_PIPELINE.md

> Версия регламента: 1.0 · Проект: browser 2D roguelike + закрытый Content Editor · Язык: RU
>
> **Назначение:** инструкция для разработчика или ИИ-агента по добавлению новой пользовательской мутации с минимальным вмешательством в движок. Любое создание, изменение параметров, тестирование и публикация мутаций происходит **только в административном редакторе**. Игрок видит исключительно результат — выбранную мутацию и ее эффекты в игре.

## 0. Нерушимые требования

1. Gameplay = server authoritative. Клиент не решает, кому нанести урон, применить статус, выдать награду или засчитать убийство.
2. Декларативные эффекты хранятся в JSON. **Никаких `eval`, `Function`, импортируемого исполняемого JS или произвольных скриптов из ZIP**.
3. Новые нестандартные алгоритмы оформляются как **доверенные TypeScript-расширения, включаемые в сборку** после ревью/тестирования. Загруженный контент-пак содержит только параметры и ссылки на зарегистрированные типы.
4. Изменение параметров готовой механики = работа только в редакторе и JSON, без сборки движка. Новый тип поведения = отдельный модуль + тесты + пересборка + новая версия игрового движка/набора расширений.
5. Код расширения не имеет прямого доступа к сети, БД, `process`, файловой системе или глобальному состоянию; все возможности предоставляются через ограниченный `MutationContext`.
6. Любой эффект детерминирован для пары «начальное состояние + версия кода/контента + seed RNG + упорядоченный поток игровых команд».
7. Игровые сохранения сериализуют состояние расширения и сохраняют версию его контракта. Загружать сохранение с несовместимой версией запрещено, пока нет миграции.
8. Каждый новый тип мутации автоматически доступен в Editor Inspector и Test Arena благодаря метаданным расширения.
9. Публикация без успешных проверок схем, ссылок, тестов совместимости и зависимостей запрещена.
10. Доступ к редактору, черновикам, административным API и публикации имеет только администратор через серверную сессию после проверки токена из `.env`.

## 1. Три режима создания мутации

| Режим | Пример | Что менять | Нужна сборка? |
|---|---|---|---|
| A — Built-in | `+15% max HP` | Только настройки редактора → `mutations.json` / `effect-definitions.json` | Нет |
| B — Visual graph | При убийстве: шанс вылечиться при HP < 40% | Узлы условия/события/действия в редакторе → типизированный JSON-граф | Нет, если узлы существуют |
| C — Custom extension | Электрическая цепь при убийстве | Новый **проверенный** TS-обработчик + схема параметров + метаданные + тесты; после регистрации настройка через редактор | Да, однократно для нового алгоритма |

**Правило выбора:** сначала попытаться реализовать тип A, затем B. Тип C применять только когда необходимых команд/условий/операторов нет в универсальном движке. Не создавать `if (mutationId === ...)` в игровом коде.

## 2. Карта ответственности и файлов

```text
apps/editor/
  src/features/mutations/                   # Только UI/ввод параметров/превью
packages/
  mutation-sdk/src/contracts.ts              # Стабильный API для обработчиков
  mutation-sdk/src/event-types.ts            # Типизированные события
  mutation-engine/src/                       # Подписки, диспетчер, lifecycle, caps
  mutation-extensions/src/
    chain-lightning/
      extension.json                         # ID, semver, события, возможности
      params.schema.json                     # JSON Schema параметров
      editor.schema.json                     # UI-поля, секции, подсказки
      handler.ts                             # Только логика эффекта
      handler.test.ts                        # Unit/property/replay tests
      README.md                              # Описание, ограничения, пример
  generated/extension-registry.ts            # АВТОГЕНЕРАЦИЯ на этапе build
  content-schemas/src/                       # Общие схемы мутаций и эффектов
content/base-game/effects/
  mutations.json                             # Карточка мутации + ссылки
  effect-definitions.json                    # Экземпляр эффекта и параметры
  custom-effect-types.json                   # Метаданные типов; НЕ исполняемый код
```

*Не редактировать `generated/extension-registry.ts` вручную.* Генератор реестра сканирует `packages/mutation-extensions/src/*/extension.json`, валидирует метаданные, генерирует статические импорты и `ExtensionRegistry` с уникальными ID. Серверная симуляция и доверенный клиентский предпросмотр компилируются с одним реестром и общей библиотекой симуляции.

## 3. Контракты и жизненный цикл

### 3.1. События

Поддерживаемые события (содержат `eventId`, `tick`, `actorId`, `origin`):

- `run.started`, `level.started`, `level.completed`;
- `attack.started`, `attack.hit`, `projectile.spawned`, `weapon.reloaded`;
- `entity.damaged`, `entity.killed`, `entity.healed`;
- `pickup.collected`, `player.dodged`, `status.applied`, `tick.elapsed`.

`eventId` — уникален в пределах забега; `tick` — номер шага симуляции; `origin` включает тип и идентификатор первоисточника. Все события детерминированно упорядочиваются `(tick, eventSequence)`.

### 3.2. Mutation SDK: минимальный интерфейс

```ts
export type EntityId = string;
export type JsonObject = object;
export type EventName =
  | 'entity.killed' | 'entity.damaged' | 'attack.hit' | 'level.started'
  | 'pickup.collected' | 'tick.elapsed'; // перечень дополняется централизованно

export interface MutationEvent {
  eventId: string;
  type: EventName;
  tick: number;
  actorId: EntityId;
  targetId?: EntityId;
  origin: { kind: 'weapon' | 'mutation' | 'environment'; id: string };
}

export interface EntityView {
  id: EntityId;
  teamId: string;
  alive: boolean;
  x: number;
  y: number;
}

export interface MutationContext {
  readonly ownerId: EntityId;
  readonly tick: number;
  readonly tickRate: number;
  owner(): Readonly<EntityView> | null;
  getEntity(id: EntityId): Readonly<EntityView> | null; // включая tombstone погибшей в текущем tick сущности
  entitiesInRadius(center: EntityId, radius: number): readonly Readonly<EntityView>[];
  isEnemyOf(target: EntityId, source: EntityId): boolean;
  random01(): number; // seed RNG движка; не Math.random()
  emitDamage(command: {
    sourceId: EntityId;
    targetId: EntityId;
    amount: number;
    damageTypeId: string;
    originExtensionId: string;
    procChainId: string;
  }): void;
  emitVfx(command: { effectId: string; entityIds: readonly EntityId[] }): void;
}

export interface MutationExtension<P extends JsonObject, S extends JsonObject> {
  readonly id: string;
  readonly version: string;
  readonly subscribedEvents: readonly EventName[];
  initialState(): S;
  onEvent(ctx: MutationContext, event: MutationEvent, params: P, state: S): S;
}
```

**Нюансы контракта:** `emitDamage` добавляет валидированную команду в очередь симуляции, не мутирует мир немедленно; очередь имеет лимит операций на tick и лимит глубины причинной цепочки. Внутренние API (`EntityView`, события, команды) являются стабильной публичной поверхностью расширений и версионируются. Для production эти интерфейсы расширяются всеми реально поддерживаемыми типами событий и команд.

### 3.3. Порядок выполнения

1. Серверный tick создает игровые события.
2. `EventBus` нормализует и упорядочивает события.
3. `MutationEngine` находит активные подписки владельцев, фильтрует отключенные/истекшие эффекты.
4. Для каждого обработчика проверяет cooldown, лимиты вызовов, предотвращение рекурсий и `params.schema.json`.
5. Вызывает доверенный обработчик через ограниченный `MutationContext`.
6. Проверяет выходные команды, применяет их через Simulation Command Queue.
7. Сохраняет обновленное serializable state расширения.
8. Публикует серверные события VFX/SFX клиентам; клиент не вычисляет достоверный урон.

### 3.4. Ограничения безопасности и производительности

- Лимит новых команд на одно срабатывание, один tick и одну причинную цепочку.
- Лимит числа целей и максимального радиуса; значения валидируются сервером.
- Запрет циклического самопрока по `procChainId`/`originExtensionId`.
- Никаких асинхронных `Promise` в `onEvent`.
- Никаких скрытых зависимостей от `Date.now()`, `Math.random()` или порядка обхода Map/Set без сортировки.
- Максимальная частота событий `tick.elapsed` задается централизованно; эффекты не должны рассчитывать собственный real-time clock.
- **Важно:** интерфейс API — не изоляция кода. Для стороннего недоверенного TS требуется изолированный процесс/контейнер с ограничением ресурсов, либо отказ от запуска такого кода. Разрешено доверять только проверенным модулям, включенным в сборку.

## 4. Пошаговый пайплайн добавления новой кастомной мутации

### Шаг 1. Заполнить Mutation Design Card в редакторе

В панели `Mutations → Create → Custom` заполнить:

```yaml
id: mutation_chain_lightning
name_ru: Цепная молния
name_en: Chain Lightning
fantasy: После убийства ближайшие враги получают цепной электрический урон
trigger: entity.killed
requirements: Убийство совершено владельцем мутации
cooldown_ms: 1200
max_stacks: 1
parameters:
  radius: 160
  max_jumps: 3
  damage: 12
  damage_type_id: electric
visuals:
  icon_sprite_id: sprite_chain_lightning_icon
  vfx_id: vfx_chain_arc
edge_cases:
  - Нет целей в радиусе
  - Несколько врагов на одинаковой дистанции
  - Игрок отключился посреди забега
  - Урон цепи убивает следующего врага
acceptance:
  - Не срабатывает при убийстве чужим игроком
  - Не поражает одну цель дважды в цепочке
  - Не запускает бесконечную рекурсию
```

Editor сохраняет Design Card в своем черновике. Карточка не заменяет исполняемую конфигурацию — она источник требований для разработчика/ИИ.

### Шаг 2. Проверить, что новой логики еще нет

1. Проверить существующие `effect-definitions` и графовые узлы.
2. Посмотреть `ExtensionRegistry`: нет ли обработчика `ext.chain_lightning` с нужными параметрами.
3. Если обработчик существует, **не добавлять новый TS-код**: создать экземпляр эффекта в редакторе.
4. Если отсутствует, создать новое доверенное расширение.

### Шаг 3. Сгенерировать основу модуля

CLI (требование к проекту):

```bash
pnpm mutation:create chain-lightning --event entity.killed
```

Команда **должна быть реализована** разработчиком. Она создает шаблоны `extension.json`, `params.schema.json`, `editor.schema.json`, `handler.ts`, `handler.test.ts` и `README.md`, но не пишет вручную код в `game-core`.

### Шаг 4. Описать метаданные и JSON Schema

`extension.json`:

```json
{
  "schemaVersion": "1.0.0",
  "id": "ext.chain_lightning",
  "version": "1.0.0",
  "subscribedEvents": ["entity.killed"],
  "parameterSchema": "params.schema.json",
  "editorSchema": "editor.schema.json",
  "handlerEntry": "handler.ts",
  "capabilities": ["query_nearby_enemies", "emit_damage", "emit_vfx"],
  "limits": { "maxCommandsPerTrigger": 8, "maxTriggersPerTick": 1 }
}
```

`params.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["radius", "maxJumps", "damage", "cooldownTicks", "damageTypeId", "vfxId"],
  "properties": {
    "radius": {"type": "number", "exclusiveMinimum": 0, "maximum": 500, "default": 160},
    "maxJumps": {"type": "integer", "minimum": 1, "maximum": 6, "default": 3},
    "damage": {"type": "number", "minimum": 0, "maximum": 200, "default": 12},
    "cooldownTicks": {"type": "integer", "minimum": 0, "maximum": 1800, "default": 36},
    "damageTypeId": {"type": "string", "minLength": 1, "default": "electric"},
    "vfxId": {"type": "string", "minLength": 1, "default": "vfx_chain_arc"}
  }
}
```

**Важно:** значения `default` в JSON Schema являются декларативной метаинформацией; генератор/редактор обязан явно подставлять значения по умолчанию. Валидатор сам по себе не обязан их применять. Для `cooldownMs` в UI выполняется перевод в ticks с учетом зафиксированного tickRate. В сети и сохранениях cooldown — целое число тиков.

`editor.schema.json`:

```json
{
  "layout": "sections",
  "sections": [
    {
      "title": "Chain Lightning",
      "fields": [
        {"path": "radius", "control": "slider", "label": "Радиус", "step": 8, "unit": "world"},
        {"path": "maxJumps", "control": "integer", "label": "Макс. целей"},
        {"path": "damage", "control": "number", "label": "Урон"},
        {"path": "cooldownTicks", "control": "duration", "label": "Перезарядка", "displayUnit": "ms"},
        {"path": "damageTypeId", "control": "reference", "targetCollection": "damage-types"},
        {"path": "vfxId", "control": "reference", "targetCollection": "visual-effects"}
      ]
    }
  ],
  "preview": "test-arena",
  "previewScenarios": ["one_target", "many_targets", "no_targets", "lethal_chain"]
}
```

Схема инспектора **не заменяет** схему валидации. Валидацию необходимо выполнять отдельно и на клиенте, и на сервере.

### Шаг 5. Реализовать обработчик через SDK

Псевдореализация, демонстрирующая ограничения API (проект обязан предоставить точные типы и компилируемую реализацию):

```ts
import type { MutationExtension } from '@game/mutation-sdk';

type Params = {
  radius: number;
  maxJumps: number;
  damage: number;
  cooldownTicks: number;
  damageTypeId: string;
  vfxId: string;
};
type State = { nextReadyTick: number };

export const chainLightning: MutationExtension<Params, State> = {
  id: 'ext.chain_lightning',
  version: '1.0.0',
  subscribedEvents: ['entity.killed'],
  initialState: () => ({ nextReadyTick: 0 }),
  onEvent(ctx, event, params, state) {
    if (event.actorId !== ctx.ownerId || ctx.tick < state.nextReadyTick) return state;
    if (event.origin.kind === 'mutation') return state; // защита от цепного самопрока
    if (!event.targetId) return state;
    const visited = new Set<string>([event.targetId]);
    let sourceId = event.targetId;
    const affected: string[] = [];
    for (let jump = 0; jump < params.maxJumps; jump++) {
      const source = ctx.getEntity(sourceId);
      if (!source) break;
      const targets = ctx.entitiesInRadius(sourceId, params.radius)
        .filter(e => e.alive && ctx.isEnemyOf(e.id, ctx.ownerId) && !visited.has(e.id))
        .sort((a, b) => {
          const da = (a.x - source.x) ** 2 + (a.y - source.y) ** 2;
          const db = (b.x - source.x) ** 2 + (b.y - source.y) ** 2;
          return da - db || a.id.localeCompare(b.id);
        });
      const target = targets[0];
      if (!target) break;
      ctx.emitDamage({
        sourceId: ctx.ownerId, targetId: target.id,
        amount: params.damage, damageTypeId: params.damageTypeId,
        originExtensionId: 'ext.chain_lightning', procChainId: event.eventId
      });
      visited.add(target.id);
      affected.push(target.id);
      sourceId = target.id;
    }
    if (affected.length) ctx.emitVfx({ effectId: params.vfxId, entityIds: affected });
    return affected.length ? { nextReadyTick: ctx.tick + params.cooldownTicks } : state;
  }
};
```

**Требование к финальной реализации:** `ctx.getEntity(sourceId)` должен возвращать snapshot позиции только что погибшего противника до окончания текущего тика (tombstone). Сортировка по `(distanceSquared, entityId)` детерминирована. Если контракт tombstone отсутствует, передавать координаты смерти непосредственно в типизированном событии. Покрыть поведение тестом. Это пример целевого SDK; его точные контракты и импорт-пути необходимо реализовать в проекте.

### Шаг 6. Подключить эффекты к контенту

`mutations.json`:

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "mutation_chain_lightning",
      "nameKey": "mutation.chain_lightning.name",
      "descriptionKey": "mutation.chain_lightning.description",
      "iconSpriteId": "sprite_chain_lightning_icon",
      "maxStacks": 1,
      "effectIds": ["effect_chain_lightning"],
      "tags": ["offense", "electric"]
    }
  ]
}
```

`effect-definitions.json`:

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "effect_chain_lightning",
      "type": "custom_extension",
      "extensionId": "ext.chain_lightning",
      "extensionVersion": "1.0.0",
      "params": {
        "radius": 160,
        "maxJumps": 3,
        "damage": 12,
        "cooldownTicks": 36,
        "damageTypeId": "electric",
        "vfxId": "vfx_chain_arc"
      }
    }
  ]
}
```

В `custom-effect-types.json` перечислить **только метаданные** зарегистрированных расширений, версии, JSON Schema ID и ограничения. Он не содержит TS-кода.

### Шаг 7. Автоматическое появление в редакторе

После пересборки доверенного пакета расширений:

1. Генератор проверяет ID/semver и создает реестр.
2. `Editor Extension Catalog` отображает новый тип `Chain Lightning`.
3. Inspector строит поля по `params.schema.json` + `editor.schema.json`.
4. `Asset Picker` проверяет `iconSpriteId`, `vfxId`, `damageTypeId`.
5. `Test Arena` запускает ту же pure simulation, что используется на сервере.
6. Пользователь визуально меняет числа/спрайты, а редактор сохраняет только JSON.

Для нового уже установленного обработчика разрешить создавать любое число мутаций с разными ID, значениями, иконками и текстами без новой сборки.

### Шаг 8. Тестирование (обязательный минимум)

- [ ] Регистрация расширения генерируется автоматически.
- [ ] `params.schema.json` отклоняет отрицательные значения, несуществующие ссылки и лишние поля (ссылки проверяются cross-reference validator).
- [ ] Мутация не активируется по чужому убийству.
- [ ] Урон наносится нужному числу уникальных целей.
- [ ] При равном расстоянии выбирается цель с лексикографически меньшим ID.
- [ ] При отсутствии целей не отправляются команды.
- [ ] Происходит cooldown, сохранение и восстановление cooldown.
- [ ] Сама цепь не запускает бесконечные повторные срабатывания.
- [ ] Переподключение игрока не дублирует эффект.
- [ ] В кооперативе засчитывается правильный владелец.
- [ ] Для фиксированного seed и входных команд результат совпадает побитово на поддерживаемой платформе/реализации симуляции.
- [ ] Мутация не создает чрезмерное число команд на tick.
- [ ] VFX виден, но клиент не решает урон.
- [ ] Превью в редакторе и серверная симуляция дают одинаковые игровые результаты.

Команды (должны быть реализованы в проекте):

```bash
pnpm mutation:validate chain-lightning
pnpm mutation:test chain-lightning
pnpm mutation:generate-registry
pnpm content:validate
pnpm test:replay
```

### Шаг 9. Публикация и версия

1. Пройти lint/typecheck/unit/integration/replay тесты.
2. Провести code review, особенно если исходный код создала нейросеть.
3. Собрать и развернуть **доверенную версию runtime + preview**, поддерживающую `ext.chain_lightning@1.0.0`.
4. В редакторе проверить таблицу совместимости `contentVersion ↔ engineVersion ↔ extensionVersion`.
5. Выполнить `Validate → Preview → Export ZIP → Publish`.
6. Опубликовать новую immutable contentVersion; активные забеги остаются на старой версии.
7. Записать в audit log кто, когда, какие настройки опубликовал и контрольную сумму пакета.

### Шаг 10. Готовность (Definition of Done)

Мутация считается добавленной, если: она создается из редактора, экспортируется в JSON, проходит импорт, реально работает на сервере, предсказуемо отображается на клиенте, переживает сохранение/восстановление, не требует условного кода по ID в ядре и проходит автоматические тесты.

## 5. Промпт для ИИ-разработчика на ОДНУ мутацию

Скопировать текст ниже и дополнить карточкой новой мутации.

> Ты — senior TypeScript game engineer. Проект использует data-driven MutationEngine и Custom Mutation SDK. Прочитай `CUSTOM_MUTATION_PIPELINE.md`, `packages/mutation-sdk/src/contracts.ts`, `packages/mutation-engine/`, `content-schemas` и существующие примеры расширений. Реализуй новую мутацию по приложенной Mutation Design Card.
>
> Сначала установи, можно ли реализовать ее существующими JSON-эффектами или визуальным графом. Если да, не добавляй TypeScript. Если нужен новый алгоритм, создай отдельный модуль в `packages/mutation-extensions/src/<slug>/` с `extension.json`, `params.schema.json`, `editor.schema.json`, `handler.ts`, `handler.test.ts`, `README.md`.
>
> Не меняй `game-core`, `simulation`, `mutation-engine`, если задача решается через публичный SDK. Не регистрируй обработчик вручную — используй генератор реестра. Не выполняй произвольный код из JSON. Для логики применяй только разрешенные методы `MutationContext`, детерминированный RNG, серверные команды и сериализуемое state.
>
> Подключи мутацию через `mutations.json` и `effect-definitions.json`, ассеты — через существующие реестры. Удостоверься, что новый тип появился в редакторе автоматически. Создай demo-сценарии Test Arena, включая граничные случаи и кооператив. Выполни typecheck, unit, replay, content validation, import/export. Если возникла необходимость изменить публичный SDK — объясни причину, предложи обратно совместимое изменение, обнови контракт и добавь тесты. В конце перечисли измененные файлы, результаты тестов и миграционные ограничения. Не выдавай заглушки за работающий функционал.

## 6. Чек-лист ревью кода, созданного ИИ

- Не добавлен ли `if (id === 'mutation_...')` в общем игровом коде?
- Нет ли `Math.random`, системного времени, сетевых запросов, прямой БД, файловых операций?
- Нет ли произвольного выполнения пользовательского JS/TS из архива?
- Присутствуют ли схема параметров и UI-описание?
- Нужны ли новые действия ядра? Если да, являются ли они универсальными?
- Ограничено ли число создаваемых сущностей/цепных событий?
- Соблюдены ли привязки к автору убийства, команде и происхождению урона?
- Сохраняется ли все состояние расширения и его версия?
- Использует ли полигон ту же логику, что и сервер?
- Работает ли импорт/экспорт без потери настроек?
- Защищена ли публикация сессией администратора?

## 7. Расширения следующего уровня

Когда базовый SDK стабилен, добавить:

- визуальный Event/Condition/Action Graph с автоэкспортом JSON;
- библиотеку многократно используемых подграфов;
- snapshot- и replay-тесты прямо из редактора;
- diff между черновиком и опубликованным пакетом;
- AI Assistant в редакторе: генерирует **предложение патча**, но не исполняет код и не публикует изменения автоматически;
- миграции параметров `extension@1.x → extension@2.x`;
- профилировщик стоимости одной мутации по events/tick, CPU и сетевым VFX.


## 8. Интеграция пользовательских мутаций со звуком и частицами

См. [`AUDIO_PARTICLES_SETTINGS_PIPELINE.md`](./AUDIO_PARTICLES_SETTINGS_PIPELINE.md). Мутация может запускать SFX/VFX/камеру по триггеру **через типизированные cosmetic-команды**, но TS-handler не должен сам создавать Web Audio/Phaser объекты. Использовать общие ID и глобальный `event-bindings.json`. В Mutation Designer добавить вкладку **SFX & VFX**: событие/условия/звук/particleEffectId/cameraEffectId, а в Test Arena — лог срабатываний и визуальный предпросмотр. Автоматизация через ИИ обязана добавлять только декларативные конфигурации эффектов, используя существующие обработчики. Нужный новый алгоритм реализуется отдельно в доверенном SDK с тестами; новые аудио/частицы сами по себе НЕ требуют нового TS extension.


## 9. Совместимость Custom Mutation SDK с новыми механиками мира

Общий регламент: [`WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md`](./WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md). Custom Mutation SDK может реагировать на `prop.destroyed`, `chest.opened`, `enemy.killed`, `boss.killed`, `loot.picked_up` и другие **серверные** семантические события — только через типизированный registry hooks. Изменения дропа/HP/атак исполняются серверной симуляцией через зарегистрированные trust-обработчики. `character.unlocked` оценивается **исключительно** progression service по unlock rules и не может быть сымитирован клиентской мутацией.

Мутация может запросить косметический `camera_effect`, `play_sfx`, `spawn_particles` через существующий event router, но не создавать Phaser emittter или camera shake напрямую. Настройки игрока (включая screenShakeStrength=0) имеют приоритет. В редакторе должна работать sandbox-арена для проверки взаимодействия мутации с разрушаемыми объектами, сундуками, наградами и событиями врагов.
