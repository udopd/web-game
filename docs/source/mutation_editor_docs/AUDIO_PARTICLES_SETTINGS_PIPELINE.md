# AUDIO_PARTICLES_SETTINGS_PIPELINE.md

> Дополнение к MASTER PROMPT — самостоятельные подсистемы звука, музыки, частиц, эффектов камеры, пользовательских настроек и общего drag-and-drop импорта. Версия регламента: 1.0. Язык: RU.
>
> **Статус:** обязательные требования для реализации игрового клиента, защищенного редактора `/editor`, серверных API и формата контент-пака. Любые изменения контента выполняются через редактор с административной сессией. Игровое меню настроек доступно игрокам без административного токена.

## 0. Цели и строгие инварианты

1. `AudioSystem`, `MusicDirector`, `ParticleSystem`, `CameraEffectSystem` — **раздельные** модули с самостоятельным жизненным циклом; общая система `PresentationEventRouter` подписывает их на типизированные события. Ни один из них не определяет урон, попадание, смерть, выпадение предметов, продвижение по уровням или изменение рейтинга.
2. Звуки и частицы конфигурируются **JSON-данными**, а не if/else для каждого оружия/персонажа/мутации. Исключение — новые универсальные виды поведения, для которых потребуется зарегистрировать доверенный TS-обработчик.
3. `sounds.json` содержит **определения SFX**, `music.json` — музыкальные треки/плейлисты и правила переходов, `particles.json` — эффекты частиц, `camera-effects.json` — эффекты камеры, `event-bindings.json` — декларативные условия и ссылки на воспроизведение. **Не дублировать** параметры ресурсов внутри оружия или мутации.
4. В контент-пак входят **дефолты** пользовательских настроек; индивидуальные настройки игрока и сохранения — **не** в экспортируемых JSON контента. Они хранятся отдельно в БД с необязательным локальным кешем для быстрого применения.
5. Веб-браузер может блокировать звук до первого осознанного действия пользователя. `AudioSystem` возобновляет `AudioContext` после клика/касания; фоновые аудио и звуки не должны запускаться в обход ограничений браузера.
6. Косметические события могут теряться/агрегироваться при лаге; результат игры от этого не меняется. Семантическое событие `entity.damaged` и его звук — разные сущности.
7. Вся загрузка приватных файлов, публикация, предпросмотр закрытого контента и операции настройки каталога доступны только авторизованному администратору. Проверка доступа выполняется на сервере для **каждого** запроса.
8. Требуется round-trip: `редактор → сохранение черновика → экспорт ZIP → повторный импорт ZIP → идентичные ссылки и параметры → игра`.

---

## 1. Модули и границы ответственности

```text
Server authoritative simulation (30 Hz)
  ├─ Combat / AI / Mutation / State / World
  └─ PresentationEventOutbox (типизированные ID событий, тик, источник, позиция, seed/sequence)
       │  websocket, deduplication, filtering
       ▼
Client PresentationEventRouter
  ├─ AudioSystem
  │    ├─ SfxMixer / Web Audio sound pool
  │    └─ MusicDirector / music tracks and transitions
  ├─ ParticleSystem / emitter instances and object pools
  ├─ CameraEffectSystem / local camera shake
  └─ AnimationController / cosmetic animation events

apps/editor/src/
  ├─ features/audio/ (SFX Library, Sound Inspector, Trigger Builder)
  ├─ features/music/ (Music Library, Playlist Editor)
  ├─ features/particles/ (Particle Library, Particle Lab)
  ├─ features/camera-effects/ (Shake Inspector, Camera Test)
  ├─ features/settings/ (preview настройки без изменения профиля игрока)
  └─ features/assets/ (единый AssetDropzone + AssetImportQueue + Resource Browser)

packages/
  ├─ presentation-events/ (contracts, event registry, deterministic event IDs)
  ├─ audio/ (AudioSystem, MusicDirector, mixer buses)
  ├─ particles/ (ParticleSystem, emitters, pooling, optional CPU renderer)
  ├─ camera-effects/ (CameraEffectSystem)
  ├─ content-schemas/ (JSON Schema + cross-reference validation)
  └─ shared-types/ (типизированные IDs и события)
```

**Крайне важно:** `ParticleSystem` может использовать Phaser renderer в игре и в тестовом полигоне редактора, но **не** должен зависеть от конкретного персонажа/оружия/мутации. Для него есть единый публичный метод `play(effectId, context)` и специализированный API паузы, остановки и очистки. Система воспроизведения должна иметь независимый `ParticleSystem` и адаптер для рендеринга. Геймплейные частицы (если когда-либо потребуется механическое влияние) обязаны быть отдельными серверными сущностями; визуальная система не может стать источником урона.

---

## 2. Формат экспортируемого контент-пака

Дополнить каталог следующими файлами:

```text
config/
  user-settings.defaults.json        # дефолты и допустимые диапазоны, НЕ данные игрока

audio/
  sounds.json                       # одноразовые/циклические SFX
  music.json                        # треки/плейлисты/переходы

visuals/
  particles.json                    # независимые системы частиц
  camera-effects.json               # предустановки тряски камеры

triggers/
  event-bindings.json               # событие + условие → действия SFX/VFX/camera

assets/
  audio/sfx/...
  audio/music/...
  sprites/particles/...
```

Добавить все шесть JSON-файлов в `manifest.json` (явный реестр файлов) и проверять SHA-256 ресурсов. JSON Schema каждой коллекции: `schemaVersion`, `items[]`, уникальные `id`, закрытые дополнительные поля (`additionalProperties: false`) на определенных схемой объектах, известные версии и строгие пределы значений. Для `config/user-settings.defaults.json` допускается объект `defaults` вместо `items` — это конфигурация, а не коллекция.

**Правила ссылок:** `soundId`, `musicId`, `particleEffectId`, `cameraEffectId`, `spriteId`, `animationId` — ID из собственных JSON. Музыка не ссылается на SFX ID; боевые JSON могут ссылаться на `eventBindingId` либо отправлять типизированные семантические события, сопоставляемые глобальными bindings. Ассеты лежат как файлы в ZIP, пути относительны корню и проверяются на traversal.

### 2.1. `audio/sounds.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "sfx_revolver_fire",
      "nameKey": "sfx.revolver_fire",
      "source": "assets/audio/sfx/revolver_fire.ogg",
      "bus": "sfx",
      "baseGain": 0.85,
      "pitch": { "min": 0.96, "max": 1.04 },
      "loop": false,
      "spatial": { "enabled": true, "referenceDistance": 160, "maxDistance": 900, "rolloff": 1 },
      "limits": { "cooldownMs": 45, "maxConcurrent": 8, "priority": 80 },
      "variants": [],
      "tags": ["weapon", "gunshot"]
    }
  ]
}
```

Требования:

- Web Audio API через типизированный адаптер аудиодвижка; поддержать несколько источников одного SFX, пространственную громкость и необязательную вариацию pitch.
- Однозначно определить формат gain: линейное значение `0..1`; пользовательский громкостной слайдер `0..100` преобразуется в gain через заданную кривую (например, с плавным уменьшением возле нуля), одинаковую для игры и предпросмотра.
- `cooldownMs` ограничивает слишком частое повторение, `maxConcurrent` и `priority` реализуют voice-stealing; не создавать новый AudioContext на каждый звук.
- Для событий с уникальным ID — подавлять дублированное воспроизведение, особенно при пересылке snapshot/повторном подключении.
- Предусмотреть SFX для `weapon.fired`, `projectile.hit`, `entity.damaged`, `entity.killed`, `player.death`, `player.victory`, `pickup.collected`, `mutation.activated`, `boss.phase_changed`, `ui.clicked`, `portal.opened` и расширяемые события.
- GUI не должен требовать написания кода для нового звука; достаточно загрузить файл, определить SFX и связать с событием.

### 2.2. `audio/music.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "music_wasteland_loop",
      "source": "assets/audio/music/wasteland_loop.ogg",
      "baseGain": 0.7,
      "loop": true,
      "loopRegionMs": { "start": 0, "end": 90000 },
      "fadeInMs": 800,
      "fadeOutMs": 1200,
      "tags": ["biome_wasteland", "exploration"]
    }
  ],
  "playlists": [
    {
      "id": "playlist_wasteland",
      "trackIds": ["music_wasteland_loop"],
      "selection": "sequential",
      "shuffleSeeded": false,
      "onEnter": "restart"
    }
  ],
  "transitions": [
    {
      "id": "music_enter_wasteland",
      "whenEvent": "biome.entered",
      "match": { "biomeId": "biome_wasteland" },
      "playlistId": "playlist_wasteland",
      "crossfadeMs": 1200
    }
  ]
}
```

Отдельный `MusicDirector` управляет фоном: меню, биом, бой с боссом, победа, пауза. Музыка не смешивается с событийными SFX. Для `loopRegionMs.end` проверять доступную длительность после декодирования; если реальная дорожка короче — ошибка валидации. Если файл доступен только после декодирования, проводить проверку на фазе публикации/предпросмотра и показывать ошибку до публикации.

### 2.3. `visuals/particles.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "particle_bullet_impact",
      "nameKey": "particle.bullet_impact",
      "spriteId": "sprite_pixel_spark",
      "emission": {
        "mode": "burst",
        "count": 16,
        "ratePerSecond": 0,
        "durationMs": 0,
        "maxAlive": 80,
        "shape": "point",
        "shapeRadius": 0,
        "directionDeg": 0,
        "spreadDeg": 360
      },
      "motion": {
        "speed": { "min": 60, "max": 240 },
        "acceleration": { "x": 0, "y": 0 },
        "gravity": { "x": 0, "y": 320 },
        "dragPerSecond": 1.4,
        "rotationDeg": { "min": 0, "max": 360 },
        "angularVelocityDegPerSecond": { "min": -360, "max": 360 },
        "alignToVelocity": false
      },
      "lifetimeMs": { "min": 200, "max": 500 },
      "sizeOverLife": [ { "t": 0, "value": 1 }, { "t": 1, "value": 0 } ],
      "alphaOverLife": [ { "t": 0, "value": 1 }, { "t": 1, "value": 0 } ],
      "collision": { "mode": "none", "restitution": 0 },
      "render": { "layer": "vfx_front", "blendMode": "normal", "tint": "#ffca70" },
      "budget": { "priority": 40, "maxParticlesPerPlay": 32 }
    }
  ]
}
```

**Физика:** распределение скорости и углов задается диапазонами, а не фиксированной точкой. `motion.acceleration` — дополнительное ускорение, `gravity` — гравитация мира для частиц, `dragPerSecond` — коэффициент экспоненциального затухания скорости `v *= exp(-dragPerSecond * dtSeconds)`. Позиция обновляется дискретными шагами с ограничением `dt` на случай долгого скрытия вкладки. Коллизия (`none`, `bounce`, `stop`) с **косметическими** поверхностями опциональна и не передает результат в боевую симуляцию. Все кривые `sizeOverLife` / `alphaOverLife` — массив упорядоченных точек `t` от 0 до 1, обязательны начальная и конечная точки, интерполяция линейная (позднее можно добавить easing).

Для произвольного эффекта доступны также: длительный `rate`-эмиттер, круг/конус/линия/прямоугольник эмиссии, привязка к сущности (follow emitter), смещение относительно цели, цвет по времени, spritesheet-анимация частиц, коллизии со стенами, смешивание слоев, масштаб и видимость. Система должна обрабатывать удаление источника и отключение VFX без утечек таймеров. Важно ограничить количество одновременно живущих частиц и эмиттеров на устройство; при перегрузке удалять низкоприоритетную косметику.

### 2.4. `visuals/camera-effects.json`

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "camera_shake_revolver",
      "type": "shake",
      "durationMs": 75,
      "amplitudePx": 3,
      "frequencyHz": 24,
      "falloff": "easeOut",
      "stacking": "max",
      "tags": ["weapon_fire"]
    }
  ]
}
```

Значение `amplitudePx` — логические пиксели камеры, не физические пиксели дисплея. Клиент масштабирует его на `userSettings.screenShakeStrength / 100` и дополнительно уважает `prefers-reduced-motion`: при включенном системном ограничении движения по умолчанию ставить `0`, если игрок не выбрал сознательно другое значение. Экранная тряска не меняет прицеливание, raycasts, коллизии или серверные координаты.

### 2.5. `triggers/event-bindings.json`

Единый роутер визуальных и звуковых эффектов. *Семантические события* определяет игровой движок; декларативные правила сопоставляют события с уже зарегистрированными ресурсами.

```json
{
  "schemaVersion": "1.0.0",
  "items": [
    {
      "id": "binding_revolver_fire",
      "event": "weapon.fired",
      "conditions": [
        { "field": "weaponId", "operator": "eq", "value": "weapon_revolver" }
      ],
      "actions": [
        { "type": "play_sfx", "soundId": "sfx_revolver_fire", "anchor": "event_position" },
        { "type": "camera_effect", "cameraEffectId": "camera_shake_revolver", "scope": "local_actor" }
      ],
      "cooldownMs": 0,
      "probability": 1,
      "enabled": true
    },
    {
      "id": "binding_bullet_impact",
      "event": "projectile.hit",
      "conditions": [],
      "actions": [
        { "type": "spawn_particles", "particleEffectId": "particle_bullet_impact", "anchor": "event_position" }
      ],
      "cooldownMs": 0,
      "probability": 1,
      "enabled": true
    }
  ]
}
```

Допустимые операторы `eq`, `neq`, `in`, `gte`, `lte`, `has_tag`; `conditions.field` выбирается из заранее зарегистрированного списка полей *этого* типа события. Нельзя вводить произвольные пути в глобальные объекты или вычислять JS-выражения из JSON. `actions` — discriminated union по `type`: `play_sfx`, `spawn_particles`, `camera_effect`, `play_animation`, `switch_music`. Вся логика ограничивается проверенными обработчиками. У событий есть `eventId`, `tick`, `sourceEntityId`, `position`, `audience`, `payload`; eventId нужен для защиты от повторного воспроизведения при сетевых реконнектах. `probability` для косметических эффектов вычисляется локально, но **если требуется межклиентская согласованность**, seed для выбора вариации передается с серверным событием. Нельзя считать локальный косметический RNG частью gameplay RNG.

Нужен связанный UI `Event Binding Builder`:

```text
[EVENT: Weapon Fired] → [IF: weaponId = revolver]
        ↓
  [PLAY SFX: revolver_fire]
  [CAMERA SHAKE: revolver]
  [SPAWN VFX: muzzle_flash] (опционально)
```

В редакторах оружия, врагов, боссов, персонажей и мутаций вкладка **SFX & VFX** использует эти же `event-bindings.json` через фильтр по `weaponId` / `entityTypeId` / `mutationId`. Не создавать в каждом редакторе собственный параллельный движок триггеров.

---

## 3. Audio Studio — UI редактора звуков и музыки

### 3.1. Sound Library

- Drag-and-drop загрузка `.wav`, `.ogg`, `.mp3`; выбор через кнопку как альтернативный путь.
- Список со строками ID, название, waveform thumbnail, длительность, теги, размер, количество использований в bindings.
- Просмотр спектра/осциллограммы, кнопки Play/Stop, loop, регулировка тестовой громкости, pitch, spatial preview (источник движется по сцене).
- Групповой импорт; массовая категоризация, поиск, сортировка, дублирование и безвозвратное удаление только после проверки ссылок.
- В инспекторе: `baseGain`, pitch interval, bus, cooldown, maxConcurrent, spatial settings, priority, ограничение полифонии, набор вариаций.
- При смене файла сохранить ID и ссылки, предупредить о некорректной длительности/кодеке и пересчитать hash.

### 3.2. Music Library

- Загрузка музыки отдельно от звуков; waveform, loop points, crossfade preview, fade in/out, плавный переход между плейлистами.
- Привязка к состояниям игры (menu, exploring, boss, victory, game over), биомам и сценам.
- `MusicDirector` должен владеть жизненным циклом дорожек: не запускать дубли при повторном событии биома; делать pause/resume и stop корректно.
- Предпросмотр в редакторе использует временный audio bus, не меняет настройки реального игрока и всегда отключается при уходе со страницы.

### 3.3. Trigger Builder

- Выбор события из каталога типов;
- выпадающие поля условий только из схемы выбранного события;
- добавление действий из `Sound Library`, `Particle Library`, `Camera Effects`, `Music Library`;
- настройка probability/cooldown/audience/anchor;
- интерактивный тест: вручную сгенерировать **косметическое тестовое событие** без мутации игрового authoritative мира;
- tracing: какой binding сработал, почему условие не прошло, какой звук/частица проиграны;
- проверка зацикливаний и избыточных bindings при публикации.

---

## 4. Particle Lab — самостоятельный визуальный редактор

Инструментарий `/editor/particles` должен быть столь же полным, как Weapon Preview.

### 4.1. Макет

**Слева** — библиотека эффектов, поиск, категории, исходные спрайты, использующие эффект объекты.

**Центр** — живой viewport Phaser с сеткой, проверочными стенами и манекеном. Курсор задает точку эмиссии. Режимы: play, pause, restart, slow motion, step one frame, 10/100 последовательных повторений, «спавн в координатах курсора», закрепление эмиттера на движущейся сущности.

**Справа** — Inspector с группами: источники/спрайт, эмиссия, направление, скорости, силы, гравитация, сопротивление воздуха, вращение, lifetime, масштаб/прозрачность/цвет, столкновения, слои, ограничения и триггеры.

**Снизу** — графики/кривые `sizeOverLife`, `alphaOverLife`, `colorOverLife`, `rotationOverLife`; диагностика: число активных частиц, число эмиттеров, CPU/frame, drop count.

### 4.2. Визуальные контролы

- Импорт спрайта или spritesheet drag-and-drop, превью и выбор `spriteId`.
- Графическая ручка направления/конуса разлета; диапазон `speed` через двойной слайдер; векторы gravity/acceleration на 2D-плоскости; вращение через круговой контрол.
- Визуальное редактирование областей эмиссии и коллизий.
- Все числовые настройки имеют значения и единицы (px/s, px/s², deg/s, ms, шт/с).
- Режимы `burst` / `continuous`, `spawn count`, `rate`, `maxAlive`, duration, color tint, render layer, blend mode.
- Автообновление preview на каждый ввод и Undo/Redo для всех изменений.
- Поддержка дочерних эмиттеров только через ограниченную глубину и проверку циклов; новые источники не должны бесконечно порождать друг друга.
- Возможность выбирать готовый emitter как визуальный эффект оружия, анимации, персонажа, босса или мутации.

### 4.3. Оговорки по производительности

- Объектный пул частиц; буферный рендеринг; ограничение количества активных частиц (например, профиль desktop/mobile в `config/balance.json` или отдельном performance policy JSON — не дублировать дефолты).
- При ограничении FPS и сворачивании вкладки корректно ограничивать dt и очищать одноразовые эффекты.
- Не отправлять каждый отдельный particle как сетевую сущность: передавать только событие создания эффекта с ID/позицией/seed.
- Изменение density/quality на клиенте влияет на количество визуальных частиц, но не на урон, попадание и RNG симуляции.

---

## 5. Игровое меню Settings

### 5.1. UI

Меню игрока `Settings → Audio / Video / Gameplay / Data` должно содержать:

| Категория | Контрол | Диапазон | Поведение |
|---|---|---|---|
| Audio | **Громкость звуков** (`sfxVolume`) | 0–100, default 80 | Изменяет только bus SFX и UI sounds |
| Audio | **Громкость музыки** (`musicVolume`) | 0–100, default 60 | Изменяет только bus Music |
| Audio | Mute SFX / Mute Music | boolean | Нулевой gain без изменения сохраненного положения слайдера |
| Video/Gameplay | **Тряска экрана при выстрелах** (`screenShakeStrength`) | 0–100, default 50 | Локальный масштаб эффекта камеры |
| Video | Reduced motion | auto / on / off | `auto` уважает ОС; `on` выключает тряску |
| Video | Качество частиц | low / medium / high | Локальное уменьшение числа косметических частиц |
| Data | **Сброс сохранений** | кнопка с подтверждением | Стирает **прогресс/контрольные точки**, не рейтинг без отдельного согласия |

### 5.2. `config/user-settings.defaults.json`

```json
{
  "schemaVersion": "1.0.0",
  "defaults": {
    "sfxVolume": 80,
    "musicVolume": 60,
    "muteSfx": false,
    "muteMusic": false,
    "screenShakeStrength": 50,
    "reducedMotion": "auto",
    "particleQuality": "high"
  },
  "limits": {
    "sfxVolume": { "min": 0, "max": 100, "step": 1 },
    "musicVolume": { "min": 0, "max": 100, "step": 1 },
    "screenShakeStrength": { "min": 0, "max": 100, "step": 1 }
  }
}
```

Все изменения ползунков должны применяться **сразу**; при `Save`/автосохранении сохраняться сервером для текущего UID. Предусмотреть `GET /api/users/me/settings` и `PATCH /api/users/me/settings` с типизированной частичной схемой и проверкой авторизации. Для гостя до окончания регистрации разрешен локальный ephemeral cache, затем синхронизация на сервер по заданному правилу (например, сохраненные серверные настройки имеют приоритет, если они существуют). Меню настроек и звуки интерфейса должны работать независимо от `/editor`.

#### Взаимодействие настройка тряски × оружие

Фактическая амплитуда = амплитуда пресета × `(screenShakeStrength / 100)` × дополнительный множитель режима accessibility (0 или 1). Настройка игрока **не** изменяет `camera-effects.json` и не влияет на других игроков. Для камеры при кооперативе применять тряску только в области локального клиента.

### 5.3. Сброс сохранений — безопасность и UX

Сброс сохранений — **разрушающая операция**, не синоним удаления профиля. Основное поведение:

1. Игрок нажимает «Сбросить сохранения» → экран подтверждения показывает, что будут удалены активные одиночные/кооперативные checkpoints, открытый прогресс, незавершенные забеги и связанные данные прохождения, **но UID, исторические рейтинговые рекорды, счетчики убийств/смертей и настройки останутся**.
2. Для подтверждения требовать явный выбор «Сбросить прогресс», желательно дополнительное подтверждение названием действия. Для активного кооперативного забега запретить сброс, пока игрок находится в комнате с незавершенной сессией (или явно оговорить единую процедуру завершения для всех). Не допускать удаления общей сессии без согласия владельца и участников.
3. Клиент вызывает `POST /api/users/me/progress/reset` с CSRF и подтверждением. Сервер проверяет идентичность игрока по сессии, игнорирует любой переданный `uid` как authority, выполняет транзакционную очистку/инвалидацию saves/checkpoints/unlocks конкретного UID и возвращает `resetAt`, `progressVersion`. Запрос должен быть идемпотентным, протоколировать событие без секретов и не затрагивать чужой прогресс.
4. После ответа обновить клиентское состояние и настройки UI без повторной загрузки старых checkpoints. При ошибке показать состояние без ложного подтверждения.
5. Отдельная опция «Удалить аккаунт и данные» (если появится позднее) должна иметь отдельный endpoint и политику удаления; **не** связывать ее с reset и не сбрасывать рейтинг через кнопку сброса сохранений.

**Важное ограничение:** общие кооперативные checkpoints хранятся на уровне `run_id`; в операции reset следует отзывать право конкретного игрока на продолжение, не удаляя чужие checkpoint records и не меняя уже зафиксированные `game_runs`/`player_stats`.

---

## 6. Универсальная загрузка файлов Drag-and-Drop

Создать переиспользуемые компоненты `AssetDropzone`, `AssetImportQueue`, `AssetBrowser`, `AssetLinkPicker` вместо отдельных не согласованных upload-кнопок.

### 6.1. Поддерживаемые ресурсы

| Объект | Форматы | Назначение |
|---|---|---|
| Sprite / кадры анимации | PNG, WebP | Персонажи, оружие, снаряды, частицы, UI |
| Spritesheet / Atlas | PNG/WebP + JSON atlas (если поддерживается) | Нарезка кадров и последовательности |
| Sound Effects | WAV, OGG, MP3 | Triggered SFX |
| Music | OGG, MP3, WAV | BGM / music playlist |
| Content Pack | ZIP | Импорт версии контента с JSON и ресурсами |

SVG не исполнять как самостоятельный HTML-документ; при необходимости поддержки безопасно растрировать отдельным проверенным процессом. Для всех форматов проверять содержимое, а не только расширение/MIME из браузера. Поддержка кодека должна определяться по фактическим возможностям браузера; при необходимости создавать альтернативные кодеки на сервере.

### 6.2. UX

- Dropzone активна при перетаскивании над областью, drag-over подсветка, возможность отменить операцию и кликнуть «Выбрать файлы» с клавиатуры.
- Drag-and-drop нескольких файлов и каталогов, **если браузер поддерживает** directory drop; иначе нативный множественный выбор. Не делать загрузку файлов обязательной исключительно через DnD.
- Общая очередь загрузки: имя, тип, размер, индикатор %, стадия `queued → validating → uploading → processing → completed/failed`, возможность отменить, повторить неудачную попытку, не дублировать успешно загруженные.
- Импорт последовательностей кадров (`idle_001.png`...) с натуральной числовой сортировкой; подтверждение порядка пользователем, обнаружение пропусков номеров.
- Предпросмотр: миниатюры изображений, waveform/длительность звуков, перечень файлов и diff при ZIP.
- Проверка дубликатов по SHA-256 с предложением «использовать существующий ресурс» / «создать новый asset ID» (намеренный дубль должен быть явным).
- Вспомогательные области загрузки доступны на каждой вкладке: Characters, Weapon Editor, Projectiles, Animation Studio, Sound Library, Music Library, Particle Lab, Room Editor, Content Import.
- Загрузчики работают через единый backend API; редактирование/загрузка через закрытый редактор строго требуют Admin session + CSRF.

### 6.3. API

```text
POST   /api/editor/assets/upload-init         # имя, размер, формат, hash, content type
PUT    /api/editor/assets/uploads/:id/chunk    # чанки, прогресс, resume по id; auth + CSRF
POST   /api/editor/assets/uploads/:id/finish   # проверка hash, обработка, запись AssetRegistry
DELETE /api/editor/assets/uploads/:id          # отмена
GET    /api/editor/assets                     # каталог + фильтры + пагинация
GET    /api/editor/assets/:assetId             # карточка ресурса
DELETE /api/editor/assets/:assetId             # удалить только если нет ссылок, иначе diff/error
```

При использовании signed upload URLs ограничивать scope объекта/размер/content-type, время действия и подтверждать финализацию на защищенном backend. В первом MVP допускается безопасный `multipart/form-data` upload, но контракт `AssetImporter` должен позволять перейти к chunked/resumable загрузке без изменений инспекторов.

### 6.4. Серверная безопасность

- Ограничить лимит размера файла и суммарного ZIP, число файлов в архиве, длину имени и путь, CPU/memory для декодирования; предотвращать zip slip / zip bomb / decompression bomb.
- Проверять фактический формат, dimensions пикселей, число кадров, допустимую продолжительность/формат аудио и sha256.
- Назначать безопасные storage keys на сервере, никогда не трактовать filename как путь файловой системы. Хранить черновики в приватном bucket/path.
- Проверять права сессии **на загрузку, список, просмотр, импорт, экспорт и удаление**. Не открывать приватные черновики через общедоступный static URL.
- Внедрить backpressure/parallel limit, временное хранилище с TTL, очистку брошенных загрузок, atomic publish и immutable content packs.
- Показать понятные ошибки пофайлово; при нескольких ошибках не оставлять полупубликованный пакет.

---

## 7. Контракты TypeScript и минимальный пример интеграции

Семантические события могут приходить из серверной симуляции или из клиентского UI. Игровой урон/решения нельзя отправлять как косметические клиентские события. Не смешивать сетевые и локальные origin.

```ts
export type PresentationEvent = {
  eventId: string;
  tick: number;
  type: string;
  sourceEntityId?: string;
  position?: { x: number; y: number };
  audience: 'all' | 'local_actor' | 'spectator';
  origin: 'server' | 'local_ui';
  payload: Readonly<Record<string, string | number | boolean>>;
};

export interface AudioSystem {
  play(soundId: string, event: PresentationEvent): void;
  setSfxVolume(value: number): void;
  setMusicVolume(value: number): void;
  stopAllSfx(): void;
  dispose(): void;
}

export interface MusicDirector {
  transitionTo(playlistId: string, crossfadeMs: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface ParticleSystem {
  play(effectId: string, args: {
    position: { x: number; y: number };
    seed: number;
    attachToEntityId?: string;
  }): string; // instanceId
  stop(instanceId: string): void;
  setQuality(quality: 'low' | 'medium' | 'high'): void;
  dispose(): void;
}

export interface CameraEffectSystem {
  play(effectId: string, localActorId: string): void;
  setStrength(value: number): void;
  setReducedMotion(enabled: boolean): void;
}

export interface PresentationEventRouter {
  dispatch(event: PresentationEvent): void;
  loadBindings(contentVersion: string): void;
  clearRecentEventIds(): void;
}
```

Реализация должна иметь отдельные тесты на dispatch, schema validation, binding matching, звуковую полифонию, глобальную паузу, порядок событий, частичный packet loss и корректный disposal. При реконнекте `clearRecentEventIds` нельзя использовать без установления нового snapshot epoch: сбросить дедупликацию произвольно означает повторить последние звуки/эффекты. Роутер должен вести окно недавних событий и epochs, чтобы не играть события прошлого забега.

---

## 8. Интеграция в существующие игровые редакторы

| Редактор | Новая вкладка / контроли | Семантические события |
|---|---|---|
| Оружие | SFX & VFX, звук выстрела, звук перезарядки, вспышка, shake preset | weapon.fired, weapon.reloaded |
| Снаряд | след, hit particles, hit SFX, визуальные эффекты взрыва | projectile.spawned, projectile.hit, projectile.destroyed |
| Лазер | звук заряда/активации, лучевые частицы | beam.activated, beam.hit |
| Melee | свист, удар, контактные частицы | melee.swung, melee.hit |
| Персонаж | звуки шага, урон, смерть, победа; частицы анимаций | entity.moved, entity.damaged, player.death, player.victory |
| Противник / босс | агрессия, фазы, смерть, particles | enemy.aggro, boss.phase_changed, entity.killed |
| Мутации | активация, завершение, статус, частицы по триггеру | mutation.activated, status.applied, mutation.expired |
| Биом/уровень | плейлист музыки, ambient, environmental particles | biome.entered, level.started, level.completed |

Звуки шагов не должны триггериться на каждый сетевой `entity.moved`; вместо этого использовать события кадра анимации шага или отдельный rate-limited footstep scheduler, локально привязанный к наблюдаемой анимации. Для длительных эффектов поддержать `start/stop` с `instanceId`: например, костер или статус горения, чтобы emitter и loop sound корректно прекращались при удалении сущности.

Анимационные события (`play_local_sound`, `spawn_cosmetic_particle`, `camera_shake_local`) должны обращаться к этому же `PresentationEventRouter` и ресурсам по ID. Нельзя создавать отдельную звуковую или партикл-систему в `AnimationController`.

---

## 9. Обязательные тесты и Definition of Done

### 9.1. Audio

- [ ] Импорт WAV/OGG/MP3; корректная обработка неподдерживаемого кодека, ошибок и отмены.
- [ ] Событие `weapon.fired` воспроизводит SFX с настроенными громкостью, pitch и ограничением полифонии.
- [ ] Громкость музыки не влияет на SFX, громкость SFX не влияет на музыку.
- [ ] Mute/unmute сохраняет выбранные уровни громкости.
- [ ] После user gesture звуки работают; до user gesture игра не падает и не пытается обойти блокировку autoplay.
- [ ] Повторный network event ID не воспроизводит звук второй раз.
- [ ] При переходе в другой биом звучит другая музыка с crossfade без одновременного бесконтрольного накопления AudioNodes.

### 9.2. Particles

- [ ] Импортировано несколько кадров/спрайт частицы, создан эффект через Particle Lab.
- [ ] Изменения диапазона скорости, ускорения, гравитации, drag, угла разлета и вращения видны **в реальном времени**.
- [ ] Burst и continuous режимы работают; эмиттер привязывается к сущности, корректно останавливается при ее удалении.
- [ ] Предел активных частиц и quality mode соблюдаются; отработка скрытой вкладки не вызывает скачок/утечку.
- [ ] Частицы никогда не становятся авторитетным источником игрового урона.
- [ ] Один `particleEffectId` работает через оружие, персонажа, мутацию и босса без дублирования конфигурации.

### 9.3. Settings / Reset

- [ ] Независимые слайдеры Music/SFX, Shake; мгновенный предпросмотр и серверное сохранение по UID.
- [ ] Нулевая тряска полностью отключает shake на этом клиенте, но не меняет эффект для других игроков.
- [ ] `prefers-reduced-motion` обрабатывается корректно.
- [ ] Сброс прогресса требует явного подтверждения и удаляет только разрешенный прогресс пользователя; UID, рейтинг и статистика остаются.
- [ ] Попытка сбросить чужие сохранения через подмену UID отвергается.
- [ ] При активном кооперативном забеге сброс не удаляет общий checkpoint других участников.

### 9.4. Import / Export / Security

- [ ] Единая очередь импорта файлов с прогрессом и кнопками отмены/повтора.
- [ ] Drag-and-drop + клавиатурная альтернатива во всех требуемых редакторах.
- [ ] Повторный импорт последовательности кадров сохраняет порядок.
- [ ] Все JSON валидируются с разрешением ссылок и проверкой manifest.
- [ ] Импорт/экспорт ZIP восстанавливает SFX, BGM, частицы, triggers, camera effects и animation events без потерь.
- [ ] Неавторизованный запрос `GET/POST/PUT/DELETE /api/editor/assets*` отклоняется.
- [ ] Проверка на ZIP traversal/bomb, MIME spoofing, чрезмерные размеры и сломанные медиа.

## 10. Пошаговый план ИИ-разработчика

1. Завести schemas: sounds/music/particles/camera-effects/event-bindings/user-settings.defaults + cross-ref validator + примеры + тесты.
2. Создать `PresentationEventRouter` и строго разделенные API `AudioSystem`, `MusicDirector`, `ParticleSystem`, `CameraEffectSystem`.
3. Реализовать `AssetDropzone`, `AssetImportQueue`, авторизованный backend загрузок, file validation и `AssetBrowser`.
4. Реализовать Sound Library, Music Library и Particle Lab с интерактивными preview и Undo/Redo.
5. Реализовать Trigger Builder; интегрировать bindings в Weapon, Character, Enemy, Boss, Mutation, Animation Editors.
6. Сделать игровые настройки и серверное API `/api/users/me/settings`; обеспечить мгновенное применение значения слайдеров.
7. Реализовать UX и транзакционную серверную операцию сброса прогресса без удаления UID/статистики/чужих checkpoint.
8. Прогнать unit/integration/e2e тесты; проверить импорт → экспорт → импорт, игру, лобби, reconnect и производительность на low particle quality.
9. Обновить документацию и пример контент-пака; показать конкретный кейс «добавить звук и 16 искр при попадании револьвера», не меняя код gameplay.

**Итоговый критерий:** администратор через `/editor` загружает звук и набор изображений частиц drag-and-drop, настраивает поведение частиц и условие запуска, публикует контент-пак; игра после загрузки опубликованной версии воспроизводит эффекты в нужный момент. Игрок отдельно управляет громкостью музыки, звуков и силой тряски, а его прогресс хранится на сервере и может быть сброшен с подтверждением.


## 11. Интеграция с декорациями, сундуками, врагами, боссами и наградами

Источник спецификации: [`WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md`](./WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md). `AudioSystem`, `ParticleSystem` и `CameraEffectSystem` **не получают отдельных реализаций** для новых сущностей. Все события создаются авторитетной симуляцией и передаются через существующий `PresentationEventRouter` и `triggers/event-bindings.json` (например: `prop.destroyed`, `chest.opened`, `enemy.attack_windup_started`, `enemy.attack_executed`, `enemy.killed`, `boss.phase_changed`, `boss.killed`, `loot.spawned`, `character.unlocked`).

- В Enemy Studio, Boss Studio, Decoration Studio и Chest Studio вкладка **SFX/VFX/Camera** — фильтр существующей базы event bindings по ID объекта и событию. Конкретный звук/частица/шейк задаются через ID общих библиотек, а не копированием параметров.
- Пресет `camera-effects.json` может иметь пространственное ослабление, scope и stacking (`max`, `replace`, `add_capped`). Пользовательская настройка `screenShakeStrength` 0–100% применяется к **любой** тряске, включая смерть босса и разрушение декорации. При 0 тряска отсутствует.
- Звук windup и привязанные частицы отменяются при серверном `enemy.attack_cancelled` / `boss.attack_cancelled`; ассеты не должны продолжать воспроизводиться после despawn.
- Любое выбывание/подбор награды может сопровождаться звуком и частицами, но косметические события не влияют на вероятность/качество/количество лута.
- Тесты: одновременная тряска от 4 игроков ограничивается общим cap, дублирующий сетевой eventId не проигрывается дважды, SFX/VFX отменяются при удалении врага, игрок с `screenShakeStrength=0` не получает движения камеры.

## 12. Унифицированный UX и предпросмотр после расширения редактора

Нормативная спецификация: `EDITOR_UI_UX_INTERACTION_SPEC.md`.

- `Audio Studio`, `Particle Lab`, `Camera Effect Studio` открываются как независимые dockable/tabbed панели; layout сохраняется, каждую можно свернуть/максимизировать и вынести во floating mode.
- `SimulationWorkbench` воспроизводит звуки, частицы и shake независимо от основного уровня: Play/Pause/Step/Reset, seed, scale, disable/reduced-motion, hitbox and event overlay.
- `Event Logic Studio` визуально соединяет семантический `chest.opened`, `enemy.killed`, `boss.attack_executed`, `weapon.fired` с `play_sfx`, `spawn_particles`, `camera_effect`. Финальный экспорт все еще использует единые `triggers/event-bindings.json`, `visuals/particles.json` и `visuals/camera-effects.json`.
- В AssetDropzone обязательны drop target outline, изменение курсора, thumbnail preview, валидатор формата до принятия файла, стадии `Uploading`, `Verifying`, `Decoding`, `Linking`, кнопки retry/cancel и понятные сообщения об ошибках.
- При работе с картой Level Studio тот же `Particle Lab` и `Event FX picker` доступны через inspector декорации, врага, сундука и boss node; не создавать в tilemap вторую систему VFX.
