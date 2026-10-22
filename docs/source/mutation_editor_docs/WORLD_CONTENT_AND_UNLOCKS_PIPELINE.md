# WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md

> **Нормативное дополнение к MASTER PROMPT.** Версия требований: 1.0.0. Охват: декорации и разрушаемость, сундуки, награды и power drops, редакторы врагов и боссов, телеграф атаки, универсальные аудио/визуальные/камерные события, разблокировка персонажей, публикация JSON и серверная проверка. Реализовать в закрытом `/editor`. Использовать общие контракты `AUDIO_PARTICLES_SETTINGS_PIPELINE.md`, `CHARACTER_ANIMATION_PIPELINE.md`, `EDITOR_SECURITY_AND_ARCHITECTURE.md`.

## 0. Инварианты — обязательны

1. **Редактор — только администратору** после входа по `ADMIN_EDITOR_TOKEN` из серверного `.env` и выдачи HttpOnly session cookie. Все API, приватные ассеты, превью, импорт/экспорт и публикация защищаются `requireEditorAdminSession`, CSRF и аудитом. Raw token никогда не включается в клиентский bundle.
2. **Server-authoritative:** появление декораций, препятствия, разрушение, сундуки, лут, редкость, прогресс, убийства, разблокировка персонажей и результаты определяются сервером. Клиент отрисовывает и воспроизводит косметику. UI редактора может работать в изолированной тестовой симуляции.
3. **Data-driven:** никаких `if (enemyId === ...)`, `if (propId === ...)` или специальных условий по названию босса. Контент определяется структурированными JSON и общими обработчиками. Новые алгоритмы — отдельные доверенные плагины игрового ядра, новые конфигурации — без правки движка.
4. `visuals/sprites.json` хранит описание спрайтов, `visuals/animations.json` — клипы. Не дублировать изображения или список кадров в `enemies.json`, `bosses.json`, `props.json`.
5. Анимация подготовки к атаке (`windup`) **необязательна** для всех врагов и боссов; если отсутствует, работает визуальный fallback и боевой таймер остается неизменным. Сама анимация не запускает урон. Длительности боевых фаз задаются на сервере.
6. **Косметические эффекты** `play_sfx`, `spawn_particles`, `camera_effect`, `play_animation`, `switch_music` задаются через единый `triggers/event-bindings.json` и диспетчер `PresentationEventRouter`. Не реализовывать отдельную тряску/звуковой движок для боссов, сундуков и декораций.
7. Новые игровые персонажи открываются только сервером после проверки фактически завершенного уровня, биома или иных разрешенных условий. Клиент не может послать запрос «разблокировать персонажа» с произвольным ID.
8. Опубликованный пакет контента **неизменяем**. Активные забеги используют фиксированную версию; изменение JSON в редакторе вступает в силу только после валидации и публикации новой версии.
9. У каждого определения — стабильный `id`; у каждого runtime-экземпляра — уникальный `entityId`. Схемы закрывают неизвестные поля, ссылки проходят cross-file validation. Все шансы/веса/распределения документированы.
10. В multiplayer лут не должен дублироваться из-за reconnect или повторной обработки смерти. Открытие сундука, уничтожение декорации, смерть врага и открытие персонажа — идемпотентные серверные операции.

## 1. Новые вкладки редактора

| Раздел | Основные инструменты | Тестовый режим |
|---|---|---|
| **Prop & Decoration Studio** | Каталог декораций, спрайты, hitbox, размеры, разрушаемость, фракция урона, коэффициенты появления, биомы, размещение по слоям | Кисть/авторасстановка, выстрел по объектам, визуализация коллизий и связности |
| **Chest & Rewards Studio** | Сундуки, условия открытия, анимация, таблицы выпадения, размер и качество награды | Смоделировать 1/100/10 000 открытий, распределение дропа |
| **Enemy Studio** | Индивидуальный инспектор врага, размеры, статы, AI-граф, оружие, спрайты/анимации/телеграф, SFX/VFX | ИИ-арена, преследование, подготовка, стрельба, смерть, лут |
| **Boss Studio** | Отдельная вкладка боссов, размеры, фазы, паттерны атак, сцены, переходы, награды | Принудительный выбор фазы/HP, таймлайн атак, телеграфы и спецэффекты |
| **Drops & Difficulty Studio** | Базовый шанс, сложность врага, веса наград, лимиты, pity-параметры, множители сложности | Вероятностные графики и массовые прогоны |
| **Character Unlock Studio** | Правила получения персонажей, условия прохождения, UID-прогресс, тексты/иконки | Симуляция прогресса и забега, без настоящей выдачи награды |
| **Event FX / Camera Effects** | Выбор SFX, VFX, shaking presets по ID, ограничения и локальная область показа | Предпросмотр всех событий, вкл./выкл. пользовательские настройки |

Каждый редактор имеет общий интерфейс: список объектов и поиск слева, визуальная сцена в центре, инспектор свойств справа, внизу журнал событий, ошибки схем, Undo/Redo, автосохранение, Preview, Validate, Export, Publish. На мобильных — вкладки вместо фиксированных колонок. Все ассеты добавляются общим **AssetDropzone** (drop файлов/папок при поддержке браузера, кнопка выбора, очередь, прогресс, отмена, retry, дедупликация SHA-256).

## 2. JSON-файлы и строгое разделение ответственности

```text
entities/
  props.json                  # визуальные/физические декорации и разрушаемые объекты
  enemies.json                # базовые параметры врагов и ссылки на AI, анимации и дроп
  bosses.json                 # фазы боссов, размеры, ссылки на атаки/награды
  characters.json             # игровые персонажи, включая unlockRuleIds или reference
world/
  biomes.json                 # зоны и их общие настройки
  room-templates.json         # шаблоны комнат, ограничения размещения
  generation-rules.json       # алгоритм, плотность объектов и правила расстановки
  decoration-spawn-tables.json # вероятности и веса появления декораций по контексту
  enemy-spawn-tables.json     # подбор противников по сложности и биому
  chests.json                 # типы сундуков и взаимодействия
  chest-spawn-tables.json     # когда, где и какие сундуки появляются
  loot-tables.json            # содержимое сундуков и drops врагов
  drop-rules.json             # частоты дропа и зависимость от difficulty score
  reward-quality-curves.json  # правила выбора редкости наград
  pickups.json                # определения предметов-подборов (HP, ammo и пр.)
  unlock-rules.json          # условия разблокировки персонажей
combat/
  attack-patterns.json        # паттерны атак, серверный тайминг windup/active/recovery
ai/
  behaviors.json              # графы FSM/behavior tree — одна ответственность
visuals/
  sprites.json                # текстуры, pivot, frame rect
  animations.json             # кадры idle/run/hurt/death/victory/windup и прочие
  particles.json              # эмиттеры/частицы
  camera-effects.json         # пресеты тряски и других эффектов камеры
triggers/
  event-bindings.json         # типизированные event → косметические действия
```

- `drop-rules.json` решает, **будет ли дроп** и как трудность влияет на шанс/число/качество; `loot-tables.json` решает, **что именно выпадет** и с какими весами. Не дублировать математику шанса в `enemies.json` и `chests.json`.
- `chests.json` определяет **поведение объекта сундука**, `chest-spawn-tables.json` — его появление, `loot-tables.json` — содержимое.
- `decoration-spawn-tables.json` определяет случайное появление декораций, `props.json` — их характеристики и внешний вид.
- `unlock-rules.json` определяет **условия получения**; серверный прогресс и UID-разблокировки **не входят** в экспортируемый контент-пак.
- `camera-effects.json` хранит **пресеты**, `event-bindings.json` хранит **где и когда** их запускать; `userSettings.screenShakeStrength` изменяет только локальную интенсивность.
- Каждый файл-коллекция имеет `{ "schemaVersion": "1.0.0", "items": [...] }`. При добавлении файлов обновить `manifest.json`, file hashes, все JSON Schema, TS-типы, UI schema, импортер, экспортер и документацию.

## 3. Prop & Decoration Studio: декорации и разрушаемость

### 3.1. Параметры декорации

- Название/описание (локализация), теги (`furniture`, `rock`, `foliage`, `cover`, `hazard`, `cosmetic`), редкость.
- Спрайт/набор анимаций, scale, pivot, render layer, глубина, размеры коллайдера, маска препятствий.
- `blocksMovement`, `blocksProjectiles`, `blocksLineOfSight` независимы друг от друга; пример: куст может блокировать обзор, но не пули.
- `destructible`, `maxHealth`, перечень принимаемых типов урона, сопротивления, `onDestroyed` через семантический `prop.destroyed`.
- Может ли разбиваться от попаданий обычных пуль, болтов, дроби, лазеров и ближнего боя: определять через единый DamageSystem, `damageType`, `hitMask` и flags оружия. Не делать частные обработчики для каждой декорации.
- После разрушения: заменить спрайт, удалить коллизию, оставить обломки-частицы, необязательный `lootTableId` (по отдельному правилу, если разрешено дизайном).
- Ручное размещение на карте и процедурный спавн по биому, номеру уровня, сложности, поверхности, отступу от стен/игроков/выхода и максимальному числу в комнате.

### 3.2. Пример `entities/props.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "prop_wooden_crate",
      "nameKey": "prop.wooden_crate.name",
      "tags": ["cover", "wood", "destructible"],
      "spriteId": "sprite_crate_idle",
      "destroyedSpriteId": "sprite_crate_broken",
      "size": { "width": 28, "height": 28, "renderScale": 1 },
      "collision": {
        "shape": "box", "width": 25, "height": 24,
        "blocksMovement": true, "blocksProjectiles": true, "blocksLineOfSight": true
      },
      "durability": {
        "destructible": true, "maxHealth": 22,
        "damageTypesAllowed": ["physical", "explosive", "energy", "melee"],
        "resistanceMultipliers": { "physical": 1, "explosive": 1.5, "energy": 0.75, "melee": 1 }
      },
      "onDestroyed": { "removeCollision": true, "replaceWithDestroyedSprite": true },
      "renderLayer": "props"
    }
  ]
}
```

В JSON Schema использовать условную валидацию: если `durability.destructible=false`, поля `maxHealth`/`resistanceMultipliers` не обязательны; если `true`, `maxHealth > 0`. Размеры и hitbox — положительные значения; `renderScale` влияет на визуал, но коллизия задается в мировых единицах. Поддерживать прямоугольник и круг.

### 3.3. Пример `world/decoration-spawn-tables.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "decorations_wasteland_common",
      "biomeId": "biome_wasteland",
      "placement": "floor_free_space",
      "countPerRoom": { "min": 1, "max": 5 },
      "densityPer100Tiles": 2,
      "spawnAttemptsPerRoom": 25,
      "minimumDistanceTiles": { "fromPlayerSpawn": 5, "fromExit": 3, "fromOtherProps": 1 },
      "entries": [
        { "propId": "prop_wooden_crate", "selectionWeight": 35, "placementProbability": 0.6 },
        { "propId": "prop_dead_plant", "selectionWeight": 65, "placementProbability": 0.85 }
      ]
    }
  ]
}
```

**Строго различать вероятность и частоту:**

- `selectionWeight` — **относительный вес** выбора типа внутри таблицы (сумму не требуется делать равной 100; 35/65 — пропорция).
- `placementProbability` — вероятность **успешного размещения выбранного** типа за попытку (0..1).
- `countPerRoom` и `densityPer100Tiles` задают ориентир/лимит числа объектов; реализация должна документировать порядок применения: сперва целевой count (из плотности, ограниченной min/max), затем попытки выбора и placement до count или исчерпания attempts.
- `spawnAttemptsPerRoom` предотвращает бесконечные циклы. Нельзя спавнить объекты поверх занятых тайлов, живых игроков, обязательных проходов и порталов.
- После расстановки **обязательно проверить связность** от spawn к выходу и ключевым точкам. Если путь блокирован — переставить/удалить объекты детерминированным алгоритмом; провал генерации логировать.
- Один и тот же seed + версия контента и генератора дают ту же карту и те же декорации. RNG дропа и RNG косметики — независимые потоки.

### 3.4. UI и тесты

В сцене редактирования: drag-and-drop `prop` на tilemap; кисть с процентом частоты, просмотр коллайдеров, дальности до выхода, динамический слой `blocked/unblocked`, кнопки **Simulate Bullet**, **Simulate Laser**, **Simulate Explosion**, **Generate 100 Maps**, статистика частоты и ошибок связности. Изменение параметра в инспекторе мгновенно обновляет preview.

## 4. Chest & Rewards Studio: сундуки

### 4.1. Настройки

- Тип сундука, `spriteId`, `animationSet` (`idle`, `open`, опционально `destroyed`), размеры, коллайдер.
- Способ открытия `interact`, `damage`, `proximity` (опционально `key`).
- `openDurationMs`, состояния `closed → opening → opened → depleted` (с возможностью закрытого/запертого состояния).
- `lootTableId`, `dropRuleId`, число наград и policy для multiplayer (`shared_world`, `individual_instanced`); дефолт: `shared_world` с серверной проверкой ownership/claim.
- События `chest.open_started`, `chest.opened`, `chest.reward_spawned`, `chest.destroyed`: их звук/частицы/тряска задаются централизованными bindings.
- Одно и то же экземпляр сундука открывается не более одного раза, даже если два игрока одновременно нажали E.

### 4.2. Пример `world/chests.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "chest_supply_small",
      "nameKey": "chest.supply_small.name",
      "spriteId": "sprite_supply_chest",
      "animationSet": { "idle": "anim_chest_closed", "open": "anim_chest_open" },
      "size": { "width": 32, "height": 24 },
      "interaction": { "mode": "interact", "radius": 40, "openDurationMs": 350 },
      "reward": { "lootTableId": "loot_supply_tier_1", "dropRuleId": "drop_chest_standard", "policy": "shared_world" },
      "collision": { "blocksMovement": true }
    }
  ]
}
```

### 4.3. Частота сундуков `world/chest-spawn-tables.json`

Нужны отдельные правила по биому/глубине/комнатам (обычная, сокровищница, босс), включая `spawnChancePerEligibleRoom` (0..1), `maxPerLevel`, `minLevel`, `maxLevel`, выбор `chestId` по весам, гарантированный дроп после босса и запрет появления на непроходимой клетке. Не хранить веса появления сундука внутри определения сундука.

## 5. Drops & Difficulty Studio: выпадение наград из врагов

### 5.1. Рейтинг сложности врага

У каждого противника есть числовой `difficultyRating` (например, 1..100), выбранный дизайнером, а также `tier` (`normal`, `elite`, `boss`). Можно показывать **рекомендованный** рейтинг сложности на основе HP, DPS, дальности, скорости, контроля и плотности атак, но он не должен тихо менять данные. Авторитетное поле — явно сохраненный рейтинг.

Уровень, биом и выбранная сложность режима влияют на **множители** шанса и качества, но не переписывают исходные таблицы.

### 5.2. Правила выпадения

Событие `enemy.killed`/`boss.killed` после серверного подтверждения инициирует `DropResolver`. Его шаги:

1. Убедиться, что `deathEventId` еще не обработан, зафиксировать server tick, участника и версию контента.
2. Найти `dropRuleId` врага или босса.
3. Рассчитать `effectiveChance = clamp(baseChance × difficultyMultiplier × levelMultiplier × modeMultiplier, 0, 1)`.
4. Взять **одну** детерминированную выборку RNG для проверки выпадения; не перепроверять шанс на клиентах.
5. Если дроп назначен — определить количество наград, тир качества и выбрать предметы по относительным весам из `lootTableId`, с фильтрами доступности и ограничениями.
6. Создать pickup-сущности сервером, рассылать события `loot.spawned` с `eventId`; при подборе выполнить атомарный claim.
7. Учесть ограничение на число находящихся на карте pickup и политику кооператива. При повторе `deathEventId` не создавать новый лут.

Пример функции difficultyMultiplier: `1 + (difficultyRating - 1) * 0.0125`, ограничение `0.5..2.25`. **Это исходная настраиваемая формула, а не правило движка**. Она находится в `drop-rules.json` как параметры универсальной линейной кривой. Для конкретного дизайна допускаются линейные/кусочно-линейные curves, задокументированные в Schema.

Сложность может влиять **раздельно** на:

- шанс, что враг что-то оставит;
- число предметов;
- вероятность редкой награды;
- тип награды (боеприпасы, здоровье, оружие, мутация, currency).

### 5.3. Пример `world/drop-rules.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "drop_enemy_default",
      "baseChance": 0.16,
      "difficultyScaling": {
        "metric": "difficultyRating",
        "curve": "linear",
        "slopePerPoint": 0.0125,
        "baseline": 1,
        "minMultiplier": 0.5,
        "maxMultiplier": 2.25
      },
      "levelMultiplier": { "type": "constant", "value": 1 },
      "modeMultiplier": { "solo": 1, "coop": 1 },
      "rollsOnSuccess": { "min": 1, "max": 1 },
      "qualityTierCurveId": "quality_standard",
      "guaranteedDrop": false
    }
  ]
}
```

`qualityTierCurveId` ссылается на регистрируемое правило качества внутри схемы/реестра кривых; **добавить файл** `world/reward-quality-curves.json` в manifest, если применяется эта модель (иначе убрать поле из схемы и примеров). Интерфейс обязан явно подсвечивать отсутствующую ссылку.

### 5.4. Пример `world/loot-tables.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "loot_enemy_common",
      "entries": [
        { "rewardType": "ammo", "rewardId": "pickup_ammo_small", "weight": 55 },
        { "rewardType": "heal", "rewardId": "pickup_health_small", "weight": 35 },
        { "rewardType": "weapon", "rewardId": "weapon_revolver", "weight": 10 }
      ]
    }
  ]
}
```

`rewardType` определяет регистр, в котором проверяется `rewardId`. Использовать типизированный union; `ammo/heal` ищутся в самостоятельном `world/pickups.json` (добавить в manifest), `weapon` — в `combat/weapons.json`. Веса — не проценты. Возможность выпадения зависит от фильтров, соответствующих версии игрового контента, и от правил режима. Если не осталось допустимых элементов, сервер не должен аварийно завершать забег: логировать контентную ошибку, а валидатор редактора должен блокировать публикацию очевидно пустых таблиц.

### 5.5. Редактор баланса

Редактор должен строить таблицу: `difficultyRating | baseChance | effectiveChance | ожидаемых предметов/100 убийств | шанс редкой награды`. Ползунок глубины уровня, режим solo/coop, тип врага. Графики должны показывать реальную формулу `DropResolver`, не выдуманный фронтенд-расчет. Кнопки **100 / 1 000 / 10 000 kills** запускают воспроизводимую проверку распределения с заданным seed; отображают фактическое отклонение и confidence interval как диагностическую величину, не гарантию конкретного выпадения.

## 6. Enemy Studio — отдельный редактор врагов

Каждый враг может отличаться **размером спрайта, коллайдером, hitbox, скоростью, HP, AI, оружием и анимациями**. Размеры в рендере и физике задаются отдельно. Hitboxes редактируются на спрайте мышью и привязаны к персонажу, а не к размеру оригинального PNG.

### 6.1. Параметры и предпросмотр

- Identity: `id`, `nameKey`, `descriptionKey`, `tags`, `tier`, `difficultyRating`.
- Visual: `spriteId`, `animationSet` (`idle`, `run`, `hurt`, `death`; `windup` опционально; `attack`/`victory` по необходимости), `renderScale`, `pivot`.
- Physics: отдельные `collisionRadius` или box, `hitbox`, mass/knockback resistance; `blocksMovement`.
- Stats: `maxHealth`, `moveSpeed`, `acceleration`, `contactDamage`, `resistances`, `xpReward`.
- Combat: `weaponIds`, `attackPatternIds`, `behaviorId`, `windupMs`, `activeMs`, `recoveryMs`, detectionRange, preferredRange.
- Rewards: `dropRuleId`, `lootTableId` (содержимое отдельно), уникальный `killXP` по правилам прогрессии.
- FX: список событий `enemy.spawned`, `enemy.attack_windup_started`, `enemy.attack_executed`, `enemy.damaged`, `enemy.killed`, `enemy.loot_spawned`; к каждому — ID bindings, не дублируемые звуковые параметры.

### 6.2. Пример `entities/enemies.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "enemy_raider",
      "nameKey": "enemy.raider.name",
      "tier": "normal",
      "difficultyRating": 18,
      "visual": { "spriteId": "sprite_raider", "renderScale": 1.5,
        "animationSet": { "idle": "anim_raider_idle", "run": "anim_raider_run", "hurt": "anim_raider_hurt", "death": "anim_raider_death", "windup": "anim_raider_windup" } },
      "collision": { "shape": "circle", "radius": 12 },
      "stats": { "maxHealth": 75, "moveSpeed": 130, "contactDamage": 8, "xpReward": 12 },
      "ai": { "behaviorId": "ai_raider_ranged", "detectionRange": 320 },
      "combat": {
        "weaponIds": ["weapon_revolver"],
        "attackPatternIds": [],
        "timing": { "windupMs": 280, "activeMs": 40, "recoveryMs": 650 },
        "preferredRange": 200
      },
      "rewards": { "dropRuleId": "drop_enemy_default", "lootTableId": "loot_enemy_common" }
    }
  ]
}
```

### 6.3. Правила `windup` (подготовки к выстрелу)

- Анимация `windup` **опциональна**, `windupMs` — отдельный обязательный параметр боевой атаки, если у атаки есть подготовка. Если нет клипа — например, подсветить спрайт или вывести индикатор направления, либо оставить без эффекта согласно настройке accessibility.
- Сервер посылает `enemy.attack_windup_started` с `attackId`, `sourceEntityId`, `startTick`, `executeTick`, позицией, направлением, `patternId`; при достижении executeTick атакует согласно combat system. Отставание FPS или отсутствие анимации на клиенте **не переносит выстрел**.
- Визуальный таймлайн выравнивает анимацию на заданный `windupMs` (отдельная настройка: `stretch`, `loop`, `holdLastFrame`), но не может изменять gameplay timing.
- Прерывания stun/death отменяют подготовку сервером и отправляют `enemy.attack_cancelled`; клиент останавливает анимацию/loop-звук/VFX.
- Телеграф атаки должен быть читаемым даже при отключении частиц/тряски — минимум индикатор, который не зависит от косметических эффектов.
- Для нескольких атак enemy/boss использовать тайминги конкретного `attackPatternId` и вариант анимации; общая анимация `windup` — fallback, не источник определения времени выстрела.

## 7. Boss Studio — отдельный редактор боссов

Создать автономную вкладку и инспектор `Boss Studio`, но **переиспользовать** редакторы анимаций, размеров и коллайдеров, AI-графов, боевых паттернов и визуальных эффектов. Не копировать логику Enemy Studio.

Дополнительно:

- Boss identity, имя, иконка, размер на экране, scale, hitbox, физическое столкновение, максимальный HP.
- Набор фаз `phaseId`, диапазоны HP, переходы по времени/событию (однозначные приоритеты), эксклюзивные анимации и музыка.
- Арена босса, ограничения перемещения, паттерны атак, спавн миньонов, иммунитеты, переключение на новые правила AI по фазе.
- Отдельный `windup` и телеграф на **каждую атаку**, если нужен; параметр необязателен на уровне анимации, боевой таймер обязателен на уровне паттерна.
- `boss.phase_changed`, `boss.attack_windup_started`, `boss.attack_executed`, `boss.damaged`, `boss.killed`, `boss.reward_spawned` могут включать одновременно SFX, частицы, музыку, тряску из общего event router.
- Награда за победу: `dropRuleId`, `lootTableId`, опциональная гарантия сундука, `unlock`-событие после завершения биома/уровня, не напрямую по клиентскому событию `boss.killed`.

### 7.1. Пример `entities/bosses.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "boss_iron_colossus",
      "nameKey": "boss.iron_colossus.name",
      "difficultyRating": 85,
      "spriteId": "sprite_iron_colossus",
      "renderScale": 2.5,
      "collision": { "shape": "circle", "radius": 36 },
      "maxHealth": 2200,
      "animationSet": {
        "idle": "anim_colossus_idle", "run": "anim_colossus_run",
        "hurt": "anim_colossus_hurt", "death": "anim_colossus_death",
        "windup": "anim_colossus_charge"
      },
      "phases": [
        { "id": "phase_1", "minHealthRatio": 0.5,
          "behaviorId": "ai_colossus_phase_1", "attackPatternIds": ["pattern_colossus_burst"] },
        { "id": "phase_2", "minHealthRatio": 0,
          "behaviorId": "ai_colossus_phase_2", "attackPatternIds": ["pattern_colossus_beam"] }
      ],
      "rewards": { "dropRuleId": "drop_boss_guaranteed", "lootTableId": "loot_boss_colossus" }
    }
  ]
}
```

Схема фаз обязана проверять покрытие диапазона здоровья, `minHealthRatio` от 0 до 1, отсутствие неоднозначности и наличие как минимум одной фазы. Пример с двумя фазами: фаза 1 применяется при HP > 50%, фаза 2 при HP <= 50%; граничное правило определяется реализацией один раз и тестируется.

### 7.2. UI испытательного полигона

Вкладки **Identity**, **Visual/Hitboxes**, **Animations**, **AI**, **Attack Patterns**, **Phases**, **Rewards**, **SFX/VFX/Camera**, **Simulation**. Отображать HP босса, текущую фазу, направление атаки, траектории снарядов и безопасные области. Кнопки `Set HP 49%`, `Force Phase`, `Play Windup`, `Trigger Death`, `Simulate 4 Players` работают **только в preview**.

## 8. Единый Event FX + универсальный Camera Shake

Использовать уже определенные `triggers/event-bindings.json` и `visuals/camera-effects.json` из `AUDIO_PARTICLES_SETTINGS_PIPELINE.md`, без второго формата и без нового модуля тряски.

Пример расширения event bindings:

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "binding_colossus_fire",
      "event": "boss.attack_executed",
      "conditions": [
        { "field": "bossId", "operator": "eq", "value": "boss_iron_colossus" }
      ],
      "actions": [
        { "type": "play_sfx", "soundId": "sfx_colossus_cannon", "anchor": "event_position" },
        { "type": "spawn_particles", "particleEffectId": "particle_muzzle_smoke", "anchor": "event_position" },
        { "type": "camera_effect", "cameraEffectId": "camera_shake_heavy_shot", "scope": "nearby_players" }
      ],
      "cooldownMs": 0,
      "probability": 1,
      "enabled": true
    }
  ]
}
```

### 8.1. Универсальные настройки тряски

Одна схема `CameraEffect`: `durationMs`, `amplitudePx`, `frequencyHz`, `falloff`, `stacking` (`max`, `add_capped`, `replace`), `maxDistance` (для пространственного ограничения) и необязательный `direction`. Игровой пользователь задает `screenShakeStrength` от 0 до 100 и `reducedMotion` в общем Settings; сила на устройстве = preset.amplitude × (strength/100) × spatialFalloff, затем clamp по безопасному общему лимиту. При значении 0 — никакой тряски.

- Для разных видов оружия, атаки врага, смерти босса, разрушения декорации и открытия сундука используем **один CameraEffectSystem**.
- Стак эффектов должен учитывать приоритет, длительность и ограничение амплитуды, чтобы множество одновременных событий не вызывало чрезмерный shake.
- Для `scope=local_actor` эффект виден только стрелявшему; `nearby_players` — всем соответствующим зрителям с затуханием от дистанции; `all_room` — всем игрокам комнаты. Сервер сообщает позицию/область события, клиент самостоятельно применяет пользовательскую настройку.
- Тряска всегда только визуальная: **не смещает серверное прицеливание, координаты и hitbox**.
- `prefers-reduced-motion` по умолчанию уменьшает/выключает тряску без дополнительных настроек, если игрок не дал осознанного override.
- Привязка звука, частиц и тряски в редакторах должна открывать **общий picker пресетов** и preview. Не создавать новое поле `shakePower` отдельно в каждой сущности.

### 8.2. Контракт событий

Нормализовать имена `prop.destroyed`, `chest.open_started`, `chest.opened`, `enemy.attack_windup_started`, `enemy.attack_executed`, `enemy.killed`, `boss.phase_changed`, `boss.attack_windup_started`, `boss.attack_executed`, `boss.killed`, `loot.spawned`, `loot.picked_up`, `character.unlocked`.

Каждое семантическое событие имеет `eventId`, `tick`, `sourceEntityId`, `position`, `payload` с типизированными полями `enemyId` / `bossId` / `propId` / `chestId` / `itemId` / `characterId` по типу события. `EventBindingBuilder` должен позволять выбрать доступные поля соответствующего типа. Контент-пак, где `conditions.field` не существует у события, блокируется валидатором.

**Граница доверия:** `character.unlocked` создается серверной progression service после коммита в БД, а не фронтенд-скриптом из анимации. Отображение уведомления о персонаже — косметика.

## 9. Character Unlock Studio: открытие новых персонажей

### 9.1. Условия

Поддержать минимум:

- `level_completed`: завершить конкретный уровень (`levelId`) или уровень номер N в конкретном биоме;
- `biome_completed`: завершить указанный биом (`biomeId`);
- `max_level_reached`: достичь глубины N;
- `boss_defeated`: победить конкретного босса (по серверному факту, при желании с дополнительным условием завершения уровня);
- `all_of` / `any_of` для комбинаций условий;
- `run_mode` (`solo`, `coop`, `any`), требования «жив в конце» либо участие в забеге;
- глобальное время/прогресс аккаунта, если позже понадобятся достижения.

Проверка «завершен» означает server-confirmed `level.completed` или `biome.completed`, а **не** просто вход на уровень или клиентский просмотр заставки.

### 9.2. Пример `world/unlock-rules.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "unlock_character_scout",
      "rewardCharacterId": "character_scout",
      "mode": "any",
      "progressScope": "account",
      "participantRequirement": "participated",
      "conditions": {
        "type": "all_of",
        "children": [
          { "type": "biome_completed", "biomeId": "biome_wasteland" },
          { "type": "max_level_reached", "levelNumber": 4 }
        ]
      },
      "permanent": true,
      "notificationKey": "unlock.character_scout"
    }
  ]
}
```

В `entities/characters.json` у персонажа есть `unlockRuleId: "unlock_character_scout"` (или `null` для стартового). Ссылка двусторонне проверяется на единственность владения правилом; альтернативно хранить только `unlock-rules.json.rewardCharacterId`, но не вводить противоречащие друг другу связи. Канонически использовать ссылку из `characters.json` и обратную проверку `rewardCharacterId`.

### 9.3. Серверное хранение

Предусмотреть таблицы:

```sql
CREATE TABLE user_character_unlocks (
  user_uid UUID NOT NULL REFERENCES users(uid),
  character_id TEXT NOT NULL,
  unlock_rule_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_run_id UUID REFERENCES game_runs(id),
  PRIMARY KEY (user_uid, character_id)
);

CREATE TABLE user_progress_events (
  id UUID PRIMARY KEY,
  user_uid UUID NOT NULL REFERENCES users(uid),
  run_id UUID REFERENCES game_runs(id),
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_uid, event_key)
);
```

В реальном Prisma schema добавить необходимые индексы и миграции, а `source_run_id` может быть nullable для системных наград. `event_key` — стабильный ключ события, сформированный сервером (например, `runId + biomeId + completionSequence`), чтобы повторный вызов не выдал награду заново.

### 9.4. Пайплайн

1. Сервер подтверждает `level.completed`, `biome.completed` или `boss.defeated` с UID участников и версией контента.
2. В транзакции сохранить запись о факте прогресса; применить идемпотентность.
3. Загрузить правила для версии данного забега, проверить их на сервере, включая solo/coop и участие/живой статус.
4. При выполнении условия выполнить `INSERT ... ON CONFLICT DO NOTHING` для разблокировки соответствующего персонажа.
5. Записать audit/progression event и после фиксации транзакции отправить `character.unlocked` в realtime и REST-profile.
6. Клиент показывает уведомление/иконку; в меню выбора персонажей новый герой становится доступен для следующего выбора. Игрок после реконнекта видит разблокировку из БД.

Для `all_of` прогресс может накапливаться между несколькими забегами по UID, только если это задано полем `progressScope` (`single_run` или `account`). Редактор обязан явно показывать scope и валидировать его. Не смешивать достижения одного забега и постоянные накопительные достижения неявно.

Сброс сохранений из пользовательского меню, описанный в `AUDIO_PARTICLES_SETTINGS_PIPELINE.md`, должен иметь **явно определенную политику:** по умолчанию удалять активные чекпойнты/текущий прогресс забега, **не удалять** `user_character_unlocks`, UID или исторические рекорды. Если когда-либо добавится «сбросить все разблокировки», это отдельное явно подтверждаемое действие и отдельный защищенный endpoint, не стандартный Reset Save.

### 9.5. UI

В **Character Unlock Studio** список заблокированных персонажей, дерево условий drag-and-drop, переключатель `single_run/account`, выбор биома/уровня из ресурсов, preview «locked/unlocked», кнопки **Simulate Completed Level**, **Simulate Completed Biome**, **Simulate Boss Defeated**. Отладочный preview работает на фальшивом UID/sandbox DB и **никогда не изменяет production-профили**.

## 10. Обновления структуры проекта и сервисов

```text
packages/
  world-generation/       # размещение и проходимость, детерминированный seed
  prop-system/            # урон декорациям через общий DamageSystem, разрушение
  reward-system/          # loot/drops/difficulty curves, защищенный RNG
  progression/            # unlock evaluator + storage adapter
  enemy-ai/               # AI graph runtime
  attack-patterns/        # серверные фазы и телеграф атаки
  presentation-events/    # единая маршрутизация косметических команд
  camera-effects/        # единый ShakeProcessor/CameraEffectSystem
  content-schemas/        # schema + links + migration
apps/editor/src/features/
  props/
  chests/
  rewards/
  enemies/
  bosses/
  unlocks/
  event-fx/
```

Рекомендуемые технологии: `@xyflow/react` для AI-/unlock-деревьев и графов; `@dnd-kit` для списков/дропзон/перетаскивания; Zod для TS API-валидации (либо TypeBox/Fastify schemas), JSON Schema + Ajv для контент-паков; `Phaser` для синхронного визуального превью; `Prisma + PostgreSQL` для транзакций прогрессии; `Vitest + Playwright` для инвариантов и UI E2E. Избегать двойной независимой реализации боевых формул в Editor и Game; предпросмотр должен использовать те же чистые функции `DropResolver`, `AttackTimeline`, `UnlockEvaluator` и общую серверную simulation core (в sandbox режиме).

### API закрытого редактора (в дополнение к ранее заданным)

```text
GET    /api/editor/props
PUT    /api/editor/props/:id
POST   /api/editor/props/:id/preview
GET    /api/editor/chests
PUT    /api/editor/chests/:id
POST   /api/editor/rewards/simulate
GET    /api/editor/enemies
PUT    /api/editor/enemies/:id
POST   /api/editor/enemies/:id/preview
GET    /api/editor/bosses
PUT    /api/editor/bosses/:id
POST   /api/editor/bosses/:id/preview
GET    /api/editor/unlocks
PUT    /api/editor/unlocks/:id
POST   /api/editor/unlocks/simulate
```

Все эти маршруты — *логические контракты*; они могут хранить объекты в одном draft project, а не в отдельных таблицах. Каждый PUT/PATCH защищается админ-сессией + CSRF, scope проекта, optimistic locking, audit log, JSON Schema. Simulation endpoints должны иметь rate limit, CPU/time budget и sandbox mode. Удаление объекта проверяет обратные ссылки из других JSON. Нельзя публично выдавать приватные черновые спрайты.

## 11. Этапы реализации для другой нейросети

1. **Schema-first**: утвердить ID, единицы измерения, детерминированный RNG, `manifest`, новые JSON Schema и ссылки; обеспечить миграцию устаревших `loot-tables.json`/`bosses.json`/`enemies.json` без потери контента.
2. **Core gameplay**: PropSystem (разрушаемые + недеструктивные препятствия), DropResolver, ChestSystem, UnlockEvaluator, единый Combat/AttackTimeline.
3. **Closed Editor UI**: Decoration Studio, Enemy Studio, Boss Studio, Chest & Rewards, Drop Simulator, Character Unlock Studio; переиспользовать Animation Studio, AssetDropzone и Event Binding Builder.
4. **Presentation**: поддержка события `windup` и необязательных клипов, пресетов camera shake/SFX/VFX; локальный preview на общей симуляции.
5. **Persistence + multiplayer**: persisted prop/chest states в checkpoints; серверное получение лута и unlock персонажей, атомарные операции и реконнект.
6. **Validation + publish**: cross-file links, probabilities, boss phase ranges, отсутствующий клип fallback, контентный hash, версия и экспорт ZIP.
7. **QA/E2E**: seed tests, генерация 100–10 000 карт, балансовые прогоны, race conditions и сохранения.

## 12. Тесты и критерии приемки (Definition of Done)

- [ ] В Prop Studio загружается спрайт и настраивается размер, hitbox, вероятность/вес появления, биом и слой.
- [ ] Разрушаемость пулями/дробью/стрелами/лазером/ближним боем работает по общему DamageSystem, включая сопротивления и снятие препятствия; декоративные объекты без `destructible` не ломаются.
- [ ] Процедурная генерация размещает декорации по seed, не перекрывает обязательный путь и ограничивает число попыток.
- [ ] Chest Studio позволяет загрузить графику, задать открытие, стоимость/условия, лут, частоту появления и тестировать открытие в sandbox.
- [ ] Дроп врагов/боссов зависит от задаваемого `difficultyRating`, уровня/режима и `dropRuleId`, с регулируемой кривой и статистикой массовых прогонов.
- [ ] В кооперативе двойное взаимодействие с сундуком и повторный `enemy.killed` не дублируют лут; награды/подбор вычисляет сервер.
- [ ] Enemy Studio — самостоятельная вкладка с hitbox, размерами и анимациями; поддерживается необязательный `windup` перед выстрелом.
- [ ] Boss Studio — самостоятельная вкладка, поддерживает разные размеры, много фаз, атаки, windup и принудительный предпросмотр фаз.
- [ ] Удары/выстрелы выполняются по серверному таймеру, даже когда нет анимации `windup`; stun/death отменяют подготовку корректно.
- [ ] Звуки/частицы для событий врагов, боссов, декораций, сундуков и наград назначаются через общие `event-bindings.json`, без написания кода конкретной сущности.
- [ ] Тряска экрана задается только пресетами `camera-effects.json`, настраивается пользователем 0–100%, уважается reduced motion, не влияет на игру/наведение.
- [ ] В Character Unlock Studio можно назначить открытие персонажа после заданного уровня/биома и задать solo/coop и scope прогресса.
- [ ] Сервер сохраняет разблокировку за UID, не разрешает повторную выдачу/подделку, восстанавливает ее при входе и не удаляет при стандартном сбросе сохранений.
- [ ] Drag-and-drop доступен для спрайтов, последовательностей кадров, аудио и контент-паков во всех новых редакторах.
- [ ] Все новые файлы включены в manifest, проходят JSON Schema, link validation, round-trip export/import и тестируются из опубликованной версии игры.
- [ ] Неавторизованный пользователь не может открыть editor API, приватные ассеты, симуляцию редактора или произвести публикацию.

**Финальное требование ИИ-разработчику:** перед завершением каждого этапа показать работающий UI-скриншот или e2e-сценарий, JSON-образцы, пройденные тесты и diff импорт/экспорт. Не считать пустые вкладки, неработающие кнопки и моковую симуляцию реализованными функциями.

## 13. Интеграция с Level Studio и Campaign Studio

**Основной документ реализации:** `LEVEL_AND_CAMPAIGN_EDITOR.md`.

- **Декорации:** определения и прочность в `entities/props.json`; частоты в `world/decoration-spawn-tables.json`; Level Studio выбирает уже определенный `propId` и задает placement, spawn zone и разрешенные override, без дублирования HP/FX/спрайтов.
- **Сундуки:** `world/chests.json` описывает поведение и анимации, `world/chest-spawn-tables.json` — частоту на карте, `world/loot-tables.json` — награды. Level Studio показывает реальные размеры, preview открытия и валидацию достижимости.
- **Враги/боссы:** Enemy/Boss Studio определяют статы, размеры, AI, атаки и optional windup. Level Studio не редактирует их статы в самом tilemap, но визуализирует реальный collision и позволяет запустить тест. Campaign Studio связывает boss arena с требуемым `levelId`.
- **Unlock:** только `world/unlock-rules.json` содержит истину о требуемом уровне/биоме/боссе; Campaign Studio показывает milestone-ссылки и симуляцию, но не изменяет серверную логику выдачи UID-открытия.
- **Новые файлы:** `world/tile-palettes.json`, `world/tilemaps.json`, `world/levels.json`, `world/level-sequences.json`; при публикации обновлять manifest/checksums, JSON Schema, типы, индексы и migration rules.
- **Визуальный UX:** общие докуемые панели, инспектор, `ContextHelpBar`, граф событий, `SimulationWorkbench`, drag-and-drop активов — по `EDITOR_UI_UX_INTERACTION_SPEC.md`.

**Сквозной smoke test:** импорт PNG пола/стен → рисование уровня → размещение разрушаемой декорации и сундука → создание spawn zone врага → переход в Campaign Studio → связь с боссом → добавление unlock milestone → Validate → Export → повторный Import → запуск server-compatible preview → Publish.
