# LEVEL_AND_CAMPAIGN_EDITOR.md

> **Нормативное дополнение к мастер-промпту.** Требования к визуальному `Level Studio` (отдельные карты, полы, стены, мобов, декорации, сундуки) и `Campaign Studio` (глобальная последовательность уровней, биомов, боссов, ветвления, правила переходов и unlocks). Встраивается в `/editor` под авторизацией через серверный админ-токен, совместимо с генерацией уровней, AI, JSON-пакетами и мультиплеером. Версия: 1.0.0.

## 0. Базовые принципы

1. **Level Studio** редактирует содержание одного уровня/шаблона: тайловые слои, врагов, декорации, сундуки, укрытия, точки входа/выхода, триггерные зоны, свет и настройки генерации.
2. **Campaign Studio** редактирует *порядок* посещения уровней и биомов: узлы прогрессии, переходы, развилки, гарантированные boss encounters, условия доступа, награды за достижение, условия разблокировки персонажей.
3. Редактор не должен смешивать уровень и кампанию. Один `levelId` можно использовать в нескольких этапах кампании с разными модификаторами сложности или spawn table overrides (в рамках разрешенной схемы).
4. JSON с картой и JSON с описанием уровня разделены. Физические/визуальные характеристики врагов, декораций и сундуков не дублируются в уровне: хранить `enemyId`, `propId`, `chestId` и позиционные данные.
5. Случайный спавн, расстановка объектов, итоговая коллизия, выбор следующего уровня и выдача unlocks выполняются **на сервере**. Клиенту передается состояние сессии; тестовые превью редактора изолированы от аккаунтов.
6. Каждый измененный объект проходит `JSON Schema + Ajv` и cross-file validation; опубликованные контент-паки неизменяемы.
7. Порядок уровней не должен зависеть от расположения узлов графа на экране: игровая семантика хранится отдельно от `editor-only` layout.

## 1. Интерфейс Level Studio

Создать отдельный workspace `/editor/level/:levelId` с возможностью открытия того же инструмента как вкладки `Level: Forest 02`.

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ LEVEL STUDIO · Forest 02 [Draft ●]   ▶ Test  ◴ Seed  Validate  Save  Export │
├───────────────┬────────────────────────────────────┬──────────────────────────┤
│ TILES /       │ [Floor] [Walls] [Props] [Enemies] │ INSPECTOR                │
│ PALETTE       │                                    │ Selected: Spawn Zone     │
│ floor variants│  +------------------------------+  │ Biome: forest           │
│ wall edges    │  |   grid / tilemap             |  │ Density: 0.2            │
│ decorations   │  |     enemies, chests          |  │ Allowed tags            │
│ entities      │  |     paths, exit             |  │ Collision / Navmesh     │
│ groups/brushes│  +------------------------------+  │ Custom FX events        │
├───────────────┴────────────────────────────────────┴──────────────────────────┤
│ Layers | Collision | Navigation | Simulation | Generator | Errors | History    │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 1.1. Палитра тайлов

- Импорт sprite tileset (PNG/WebP) из общего `AssetBrowser` перетаскиванием.
- Деление на тайлы по `tileWidth/tileHeight`, без фильтрации текстур.
- Переключение палитр `Floor`, `Wall`, `Wall Edge`, `Decor`, `Hazard`, `Cover`; палитра содержит определения и теги, а не дублирует PNG.
- Autotiling: bitmask 4/8-neighbor (по выбору правил палитры), уголки, внешние/внутренние края, повторяемые паттерны, variants by weight.
- Настраиваемый pivot, offset, flip/rotate тайлов при разрешении, collision mask и плотность покрытия.
- Для переходов на другие биомы — преобразование tile IDs через palette mapping (не автоматически по сходству цвета).

### 1.2. Основные инструменты рисования и редактирования

| Инструмент | Функция |
|---|---|
| Pencil / Eraser | Рисовать и очищать отдельные клетки |
| Rectangle / Filled Rectangle | Комнаты, стены, полы и ограждения |
| Bucket Fill | Заливка связанной области на выбранном слое |
| Line | Прямые стены, дорожки, линии опасности |
| Brush / Stamp | Настраиваемая кисть, multi-tile prefab, декорация с несколькими клетками |
| Selection | Прямоугольное/полигональное выделение, копирование, перенос и удаление |
| Eyedropper | Выбор тайла/типа объекта с карты |
| Place Entity | Враги, сундуки, декорации, интерактивные объекты |
| Spawn Zone | Области генерации с weights, tags и constraints |
| Entrance / Exit | Точки входа/выхода и привязанные события |
| Collision Brush | Редактор collision/cover/hazard слоя |
| Path Debugger | Проходимость и отладка поиска пути |
| Event Zone | Trigger-volume с привязкой к Event Graph |

Горячие клавиши документировать в интерактивной верхней панели `Context Help Bar`. Drag выделения показывает обводку, клеточную привязку, координаты, ghost-превью и подсветку конфликтов; кисть не должна наносить тайлы вне допустимых слоев.

### 1.3. Слои

Обязательные слои и приоритеты отрисовки:

1. `floor` — непроходимость не задается, если tile type не содержит отдельного walkability modifier.
2. `floor_details` — трещины/следы/варианты пола (обычно cosmetic).
3. `wall_base` — геометрия препятствий.
4. `wall_top` — верхние части стен, occlusion/рисование поверх персонажей при соответствующем z-rule.
5. `static_props` — статические декорации и укрытия.
6. `dynamic_entities` — враги, сундуки, интерактивные props, отдельные spawn markers.
7. `markers` — точки игрока, спавна/лут, выходы, навигационные anchors.
8. `trigger_zones` — зоны событий и условий.
9. `fx_preview` — только превью VFX, не экспортировать как статический игровой тайл.

Для каждого слоя: visibility, lock, opacity (UI-only), reorder within permitted groups, batch selection. Правила рендер-слоев задает schema, физику не определять визуальным порядком слоев.

### 1.4. Размещение и настройка сущностей

Перетаскивать врагов, боссов, декорации, сундуки и pickups из `AssetBrowser` на карту. Объект должен хранить только:

- `placementId` (стабильный ID размещения), `definitionId` и `kind`;
- `position`, `rotationDeg`, `scale` (при разрешенной размерной коррекции);
- `spawnMode`: `fixed` | `weighted` | `triggered`;
- `spawnTableId` или `spawnGroupId` для случайного спавна;
- `conditions` или `eventGraphId` как ссылки;
- разрешенные overrides **на уровне конкретного экземпляра**, объявленные схемой сущности (например, визуальная ориентация, но не произвольные поля).

Допустимое число размещений в комнате/уровне и сложность врагов проверяет validator. У каждого врага могут быть свои размеры и hitbox из `entities/enemies.json`; при размещении editor визуализирует реальные габариты и проверяет отсутствие пересечения стен/других обязательных entity.

### 1.5. Спавн врагов, декораций, сундуков

Для каждого `Spawn Zone` задаются: прямоугольник/полигон, tags (room/biome/difficulty), применимая `enemy-spawn-table`/`decoration-spawn-table`/`chest-spawn-table`, budget, min/max count, minimum distance to player spawn, минимум от стен, взаимный отступ, условия активации.

- Вероятность spawn события (`0…1`) **не** равна весу конкретного объекта в таблице (`weight > 0`): UI обязан пояснять разницу и показывать итоговую вероятностную модель.
- Появление сундуков и дропа врагов на сервере управляется существующими `chest-spawn-tables.json`, `drop-rules.json`, `loot-tables.json`.
- Не создавать копии enemy stats в `level.json` и не размещать готовые loot distributions в карте.
- У редактора есть режим визуального симулятора `Generate 1 / 10 / 100 / 1000 maps` с тепловыми картами spawn-позиций и распределением бюджета сложности.

## 2. Визуальные оверлеи и preview уровней

Обязательные overlays: `Grid`, `Collision`, `Navmesh`, `Walls`, `Cover`, `Spawn Areas`, `Detection Radius`, `Patrol Paths`, `Exit Reachability`, `Difficulty Heatmap`, `Interactables`, `Event Zones`, `Lighting`, `Loot Map`. Изменение параметра приводит к локальной проверке затронутого фрагмента; тяжелая full-map validation выполняется асинхронно с прогрессом.

`Test Level` открывает самостоятельную симуляцию на текущем черновике без публикации и статистики. Доступны: Free Camera / Player Control, выбранный персонаж, seed, Pause, Step, Speed, forced loot, включить/выключить enemy AI, invulnerability для отладки, показать траектории и логи. Для multiplayer preview — изолированный test room, без публичных результатов.

Валидатор карты обязан проверять:

- существование всех tileIds и ссылок на объекты;
- отсутствие spawn игрока внутри твердых препятствий;
- существование хотя бы одного допустимого входа и выхода по правилам уровня;
- достижимость выхода по navmesh с учетом правил разрушения препятствий и возможностей персонажа;
- свободное пространство для крупных боссов и камер;
- отсутствие размещенных врагов в непроходимых клетках;
- читаемые зоны появления/переходов и отсутствие неподъемной сложности;
- отсутствие пересечения обязательных элементов с неразрушимыми стенами;
- отсутствие бесконечного цикла событий на карте.

## 3. Два режима подготовки уровней

### 3.1. Handcrafted

Автор вручную рисует весь уровень в `world/tilemaps.json`, расставляет сущности и маркеры. Случайность допускается в разрешенных spawn zones и variante tiles, но геометрия фиксирована.

### 3.2. Procedural

Автор задает `generationRuleId`, `roomTemplatePoolId`, biome и размер/плотность. Алгоритм из `world/generation-rules.json` генерирует карту по seed. В `room-templates.json` хранятся вручную подготовленные комнаты и ограничения их стыковки; `tilemaps.json` может хранить заготовки шаблонов. Генератор **не должен** напрямую читать UI layout или панельный state.

### 3.3. Hybrid

Генерируется основная карта, поверх которой размещаются обязательные handcrafted room templates: стартовая зона, boss arena, секретная комната, сюжетный выход. Все вставки проходят повторную проверку связности.

Каждый уровень обязан объявлять `generationMode: handcrafted | procedural | hybrid`; инспектор показывает только соответствующие поля. `Test 100 Seeds` работает только там, где есть процедурные компоненты.

## 4. JSON файлы, схема ответственности

```text
world/
  tile-palettes.json         # tile definitions: sprite refs, auto-tile rules, terrain/collision semantics
  tilemaps.json              # вручную сохраненные клетки слоев и фиксированные placements
  room-templates.json        # id шаблона + ссылки на tilemap + входы/ограничения использования
  levels.json                # уровень: biome, generationMode, tilemap/generator, gates, spawn refs
  biomes.json                # биом: стиль, доступные палитры, глобальные правила биома
  generation-rules.json      # процедурный алгоритм и параметры геометрии
  enemy-spawn-tables.json    # веса врагов и difficulty budget
  decoration-spawn-tables.json # частоты декораций
  chest-spawn-tables.json    # частоты/типы сундуков
  loot-tables.json           # содержимое наград
  level-sequences.json       # граф кампании и переходов
  progression.json           # правила мета-прогрессии, если включены
  unlock-rules.json          # критерии разблокировки персонажей
editor/
  level-workspace-layouts.json # только UI раскладка/selection, НЕ экспортировать в runtime pack
  graph-layouts.json        # только положение узлов, НЕ правила игры
```

**Правило:** каждый файл коллекции имеет `{ "schemaVersion": "1.0.0", "items": [...] }`, индексы `id` уникальны в соответствующих пространствах, ссылки валидируются. `manifest.json` содержит все runtime JSON и SHA-256. UI-only metadata сохраняются в черновике редактора и могут входить в отдельный архив исходников редактора, но **не** смешиваются с runtime пакетом игры.

### 4.1. Пример `world/tile-palettes.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "palette_forest",
      "tileSize": 16,
      "tiles": [
        { "id": "tile_forest_floor", "spriteId": "spr_forest_floor", "terrain": "floor", "walkable": true, "projectileBlocking": false, "variants": [{ "spriteId": "spr_forest_floor", "weight": 1 }] },
        { "id": "tile_forest_wall", "spriteId": "spr_forest_wall", "terrain": "wall", "walkable": false, "projectileBlocking": true, "autotileRuleId": "autotile_wall_4way" }
      ]
    }
  ]
}
```

Для `autotileRuleId` определить локальный типизированный реестр алгоритмов/таблиц bitmask; не хранить неисполняемый идентификатор без валидируемого определения. Sprite IDs должны существовать в `visuals/sprites.json`.

### 4.2. Пример `world/tilemaps.json`

Схема ниже демонстрирует маленькую карту 5×5 и целевое сериализованное представление. Для больших карт разрешено RLE/чанковое хранение, но сохранять семантику тайлов и равномерность декодирования.

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "tilemap_forest_room_a",
      "paletteId": "palette_forest",
      "width": 5,
      "height": 5,
      "layers": [
        {
          "id": "floor",
          "cells": [
            ["tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor"],
            ["tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor"],
            ["tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor"],
            ["tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor"],
            ["tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor", "tile_forest_floor"]
          ]
        },
        {
          "id": "wall_base",
          "cells": [
            ["tile_forest_wall", "tile_forest_wall", "tile_forest_wall", "tile_forest_wall", "tile_forest_wall"],
            ["tile_forest_wall", null, null, null, "tile_forest_wall"],
            ["tile_forest_wall", null, null, null, "tile_forest_wall"],
            ["tile_forest_wall", null, null, null, "tile_forest_wall"],
            ["tile_forest_wall", "tile_forest_wall", "tile_forest_wall", "tile_forest_wall", "tile_forest_wall"]
          ]
        }
      ],
      "placements": [
        { "placementId": "player_spawn_a", "kind": "marker", "definitionId": "marker_player_spawn", "position": { "x": 40, "y": 40 }, "spawnMode": "fixed" },
        { "placementId": "exit_a", "kind": "marker", "definitionId": "marker_level_exit", "position": { "x": 56, "y": 56 }, "spawnMode": "fixed" }
      ]
    }
  ]
}
```

**Примечание:** размещение start и exit в разных проходимых точках — только часть проверки: даже небольшая демонстрационная карта должна проходить валидатор доступности и условий завершения. Маркеры `marker_*` должны быть объявлены в строго типизированном реестре системных marker kinds; это не ссылка на спрайт/врага.

### 4.3. Пример `world/levels.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "level_forest_01",
      "nameKey": "level.forest_01.name",
      "biomeId": "biome_forest",
      "generationMode": "hybrid",
      "generationRuleId": "gen_forest_rooms_v1",
      "roomTemplatePoolId": "pool_forest_small",
      "requiredRoomTemplateIds": ["room_forest_spawn"],
      "enemySpawnTableId": "spawn_enemies_forest_early",
      "decorationSpawnTableId": "spawn_props_forest",
      "chestSpawnTableId": "spawn_chests_forest",
      "difficultyBudget": 12,
      "requiredMarkers": ["player_spawn", "level_exit"]
    }
  ]
}
```

`requiredMarkers` — типизированные системные виды, не ID конкретных placements. Механика генерации/размещения описана в generation rules. `biomeId` должен существовать в `world/biomes.json`.

## 5. Campaign Studio — редактор последовательности уровней

Создать отдельную страницу `/editor/campaign/:sequenceId` с графовым canvas и двумя синхронизированными представлениями:

1. **Graph View:** узлы-уровни, биомы, боссы, развилки, unlock milestone, финал, соединения и условия переходов.
2. **Timeline/List View:** упорядоченная текстовая последовательность для линейной кампании; доступная клавиатурой, удобная для проверки порядкового номера и сквозной сложности.

Обязательные операции:

- Создать узел уровня с выбором `levelId` или `levelPoolId`, назначить имя и тип.
- Перетащить узел, соединить выход одного с входом другого, поменять порядок узлов без потери ссылок.
- Добавить развилку `weighted_random`, `player_choice` или `condition`, визуально показывая веса/исходы.
- Настроить обязательный boss-node после N уровней или после завершения биома.
- Назначить испытание, альтернативный уровень, секретную ветку и checkpoints.
- Поместить unlock milestone (информативно) со ссылкой на `unlockRuleId`, но **правило и выдача** живут только в `world/unlock-rules.json` и server progression service.
- Назначить допустимые mode restrictions (single/co-op), difficulty scaling, overrides пресетов спавна, правила повторяемости уровней.
- Отобразить прогноз среднего числа комнат/врагов и граф кривой сложности по этапам.

### 5.1. Граф кампании: концептуальная структура

```text
        [START]
           │
     [Forest 01]
           │
     [Forest 02] ──────> [Secret Room]
           │                    │
       [Boss A] <──────────────┘
           │
  [Unlock Milestone]
           │
       [Desert 01]
           │
       [Desert Boss]
           │
         [END]
```

Позиции и форма блоков не влияют на геймплей. После сохранения граф может быть открыт как последовательный список; порядок переходов при `weighted_random` определяется seed/весами на сервере, а не расположением на canvas.

### 5.2. Разделение узлов и правил перехода

Каждый узел содержит:

- `nodeId` уникальный в рамках sequence;
- `kind`: `level`, `boss`, `milestone`, `end`;
- `levelId` только для `level/boss`;
- `unlockRuleIds` только как ссылки для milestone;
- `difficultyScale` как разрешенный множитель пресета;
- `tags` для UI и условий.

Переход (`edge`) содержит:

- `edgeId`, `fromNodeId`, `toNodeId`;
- `selection`: `always`, `weighted_random`, `player_choice`, `condition`;
- `weight` для weighed branch, `conditionRuleId` для заранее зарегистрированных декларативных условий;
- `priority` (там, где нельзя несколько одновременных переходов).

**Прямые циклы** запрещены в кампании с конечным прохождением; для endless допустим только специальный повторяющийся region node с явно заданным `maxRepeats` либо `endless=true` и прогрессией сложности. Валидатор исключает случайные бесконечные маршруты.

### 5.3. Пример `world/level-sequences.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "campaign_standard",
      "nameKey": "campaign.standard.name",
      "startNodeId": "n_start",
      "nodes": [
        { "nodeId": "n_start", "kind": "milestone", "unlockRuleIds": [], "tags": ["start"] },
        { "nodeId": "n_forest_01", "kind": "level", "levelId": "level_forest_01", "difficultyScale": 1, "tags": ["forest"] },
        { "nodeId": "n_forest_boss", "kind": "boss", "levelId": "level_forest_boss", "difficultyScale": 1.2, "tags": ["boss", "forest"] },
        { "nodeId": "n_unlock", "kind": "milestone", "unlockRuleIds": ["unlock_wanderer_after_forest"], "tags": [] },
        { "nodeId": "n_end", "kind": "end", "tags": [] }
      ],
      "edges": [
        { "edgeId": "e1", "fromNodeId": "n_start", "toNodeId": "n_forest_01", "selection": "always" },
        { "edgeId": "e2", "fromNodeId": "n_forest_01", "toNodeId": "n_forest_boss", "selection": "always" },
        { "edgeId": "e3", "fromNodeId": "n_forest_boss", "toNodeId": "n_unlock", "selection": "always" },
        { "edgeId": "e4", "fromNodeId": "n_unlock", "toNodeId": "n_end", "selection": "always" }
      ],
      "modeIds": ["solo", "coop"],
      "endless": false
    }
  ]
}
```

`level_forest_boss` и `unlock_wanderer_after_forest` — обязательные ссылки на отдельно определенные объекты: при отсутствии этих записей import/validate блокируется. Milestone **не выдает** персонажа автоматически: progression service проверяет `unlock-rules.json` после серверного подтверждения завершения требуемого уровня/биома.

### 5.4. Выбор следующего узла на сервере

1. Завершение текущего узла подтверждается состоянием симуляции (enemy-clear, boss death, exit interaction или иной allowed completion rule).
2. Сервер фиксирует `campaignId`, `nodeId`, `levelId`, seed, выбранные переходы и участника-инициатора события.
3. Проверяются ребра, ограничения режима и условия. Для weighted branch RNG берется из server-authoritative seed, сортировка кандидатов стабильна.
4. В coop применяется правило владельца/голосования/готовности, заданное режимом комнаты. Клиент не решает конечную ветку без серверного подтверждения.
5. Сервер сохраняет checkpoint с новым `campaignNodeId`, запускает генерацию следующего уровня и отправляет snapshot.
6. Progression service оценивает все unlock-rules по достоверным событиям и idempotency keys. Никаких UI-обходных путей для разблокировки.

### 5.5. Что делать с бесконечным режимом

Разрешить `endless=true` для кампании с регионами повторения или автоматически подбираемой последовательностью `levelPoolId` по curve + seed. Явно определить завершение уровней, порядок смены биомов, правила обязательных боссов и масштабирование сложности. Не использовать бесконечный граф неограниченных произвольных циклов.

## 6. Preview и инструменты проверки последовательности

### 6.1. Preview graph

При выборе узла справа показывать `Level Thumbnail`, Biome, Enemy Budget, Expected Loot, Boss ID, Next Edges. Двойной клик по level node открывает карту в Level Studio на новой вкладке; возврат сохраняет zoom/position графа.

### 6.2. Симулятор кампании

- `Simulate 1 Run`: отображает последовательность реально выбранных узлов и seed.
- `Simulate 100 / 1000 Runs`: показывает частоту посещений ветвей/боссов, распределение длин забегов, долю unreachable и качество гарантированных unlock milestones.
- `Plot Difficulty`: граф `campaign stage → predicted enemy budget`, со split по modes.
- `Validate Flow`: проверяет входы/выходы, доступность всех intended узлов, дубли ID, отсутствующие `levelId`, недостижимые milestones, бесконечные циклы, завершение и совместимость версий.
- `Preview Next Level`: запускает server-compatible generation в изолированном sandbox режиме.

### 6.3. Ошибки, предупреждения и автоисправления

Ошибки блокируют publish: отсутствующий `levelId`, стартовая вершина, невалидный edge, необеспеченный boss-room, недостижимый выход, незадекларированный infinite loop, unavailable sprites. Предупреждения не всегда блокируют: слишком редкий сундук, избыточная сложность, чрезмерный переход цветов биомов, наличие невостребованного secret node.

Каждая проблема должна показывать **ссылку на объект и поле**, а не только общий текст `Validation failed`. Автоматические исправления допустимы только с предпросмотром diff и Undo.

## 7. API и безопасность

Добавить к закрытому редакторскому API (под `requireEditorAdminSession`, CSRF, versioned update и аудитом):

```text
GET    /api/editor/projects/:projectId/levels
POST   /api/editor/projects/:projectId/levels
PATCH  /api/editor/projects/:projectId/levels/:levelId
GET    /api/editor/projects/:projectId/levels/:levelId/validate
POST   /api/editor/projects/:projectId/levels/:levelId/simulate
GET    /api/editor/projects/:projectId/sequences
POST   /api/editor/projects/:projectId/sequences
PATCH  /api/editor/projects/:projectId/sequences/:sequenceId
POST   /api/editor/projects/:projectId/sequences/:sequenceId/validate
POST   /api/editor/projects/:projectId/sequences/:sequenceId/simulate
```

**Важно:** GET validation должен быть side-effect-free; если validation создает длительное server job или сохраняет результаты, использовать POST и job status endpoint. Тесты не должны писать значения в настоящие `player_stats`, `run_participants`, `unlocked_characters` и рейтинги.

Сервер ограничивает размер тайловых карт, число placements, сложность условий, seed batches, процессорное время симуляции и доступ к ресурсам. Защита от zip-slip и опасных upload файлов — через уже заданный Asset Import API.

## 8. Технические компоненты

- `LevelCanvas` — tile renderer, camera pan/zoom, grid, overlays.
- `TilePalettePicker` — выбор палитр, импорт и autotiling.
- `BrushEngine` — Pencil/Fill/Rectangle/Stamp с транзакциями Undo/Redo.
- `EntityPlacementTool` — drag-and-drop сущностей и проверка позиций.
- `SpawnZoneEditor` — полигоны/числа/таблицы вероятностей.
- `MapValidator` — связность, geometry, collision, boss fit, references.
- `ProceduralPreviewRunner` — batch seeds, heatmaps, визуализация.
- `CampaignGraphEditor` — граф прогрессии с типизированными портами и сохранением layout отдельно от semantic graph.
- `CampaignSequenceCompiler` — схема → deterministic server sequence.
- `ProgressionPreview` — проверка unlock requirements без выдачи реальной награды.
- `WorldContentExporter` — собирает строго структурированные `world/*.json` и обновляет manifest/checksums.

UI: `React/TypeScript`, `dockview-react` для окон, `@xyflow/react` для Campaign Graph, Phaser renderer для карты, общий `packages/simulation` для тестовой физики и спавна. Не делать параллельных движков коллизий для редактора и сервера.

## 9. Тесты и Definition of Done

- [ ] Можно импортировать spritesheet пола/стен, нарезать его, назначить tile palette, нарисовать карту, сохранить и переоткрыть без потери данных.
- [ ] Можно разместить enemy/chest/prop как фиксированный объект и как случайный spawn zone с отдельно настраиваемыми шансами/весами.
- [ ] Drag placement подсвечивает валидные/невалидные клетки и реальный collision footprint большого босса.
- [ ] Tilemap layers, Undo/Redo для кистей, выделение, копирование, multi-select, zoom/pan работают.
- [ ] Автоматическая проверка находит недостижимый выход, размещение внутри стены и отсутствующий sprite/definition ID.
- [ ] Можно генерировать карту из seed, менять плотность комнат/врагов и проверять 100 seeds с выводом статистики.
- [ ] Можно создать кампанию из ≥5 узлов с биомами, боссом и развилкой; drag node и connecting edges работают.
- [ ] Можно просмотреть ту же последовательность в виде списка и вернуть граф без потери данных.
- [ ] Узел кампании открывает связанный уровень в новой editor tab, изменения не ломают связи.
- [ ] Условия открытия персонажа указываются через ссылки на `unlock-rules.json` и подтверждаются только сервером.
- [ ] Coop проход не позволяет одному клиенту подменить уровень/босса и самовольно выдать unlock.
- [ ] Все новые JSON валидируются, ссылки существуют, экспортируются в ZIP, manifest и SHA-256 обновляются.
- [ ] Экспортированный контент загружается игрой, а активная сессия продолжает использовать закрепленную версию пакета.

## 10. Порядок работы ИИ

1. Спроектировать JSON Schema для `tile-palettes`, `tilemaps`, `levels`, `level-sequences` и отдельную UI-schema. Документировать ID, ссылки, grid units и ограничения.
2. Реализовать core tilemap decoder/renderer, collision construction и существующие generator adapters.
3. Реализовать `LevelCanvas` с рисованием пола/стен и системой Undo/Redo.
4. Добавить asset drop + palette import + autotile + слой objects.
5. Добавить spawn zones, collisions, AI visualization, real procedural previews.
6. Реализовать `Campaign Studio` и compiler, подключить реальные уровни и branches.
7. Связать progression/unlock rules, семантические events и серверную валидацию.
8. Написать test fixtures, E2E drag/pan/paint, deterministic generation, multiplayer progression.
9. Проверить экспорт/импорт ZIP, version pinning, rollback при неудачной публикации.
10. Добавить интерактивные подсказки в `ContextHelpBar` для каждого инструмента карты/кампании.

**Итог:** пользователь собирает графический уровень и сквозную последовательность кампании без изменения исходного кода. В игре на сервере используются только валидные опубликованные JSON и безопасные универсальные обработчики.
