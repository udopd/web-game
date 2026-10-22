# EDITOR_SECURITY_AND_ARCHITECTURE.md

> Дополнение к MASTER PROMPT: усиленная система мутаций, покадровые анимации, SFX/BGM, Particle Lab, декорации, сундуки и дроп, редакторы врагов и боссов, открытие персонажей, игровые настройки, drag-and-drop, закрытый административный редактор и технологические рекомендации.

## 1. Обновление требований редактора

Редактор (`/editor`) — закрытая административная подсистема. Игровые страницы, публичные API профилей, игровая симуляция и лобби не требуют административного токена. **Все операции редактора**, включая загрузку списка проектов, предпросмотр приватных черновиков, импорт, экспорт, сохранение и публикацию, требуют активной административной сессии.

В редактор добавляются разделы:

- **Mutation Library**: список мутаций, версий, зависимостей и обратных ссылок; дублирование, поиск, сравнение конфигураций;
- **Mutation Designer**: карточка назначения, условия выдачи, триггеры, теги, изображения, описание, веса выпадения, редкость, стеки;
- **Effect Graph**: конструктор событий, условий, фильтров, действий, задержек, модификаторов;
- **Extension Catalog**: реестр доверенных TS-типов эффектов и их совместимости с runtime;
- **Parameter Inspector**: генерируемый из JSON Schema и UI schema инспектор для кастомных типов;
- **Mutation Test Arena**: предпросмотр на симуляции общего game-core, отладочные хитбоксы, события, лог действий, счетчики;
- **Balance Lab**: сравнительная статистика DPS, survivability, вероятностей, распределений при моделировании;
- **Validation & Publication**: ошибки схем, отсутствующие ссылки, зависимости расширений, сравнение версий, экспорт ZIP.

При создании пользовательской мутации сначала предлагаются Built-in / Visual Graph / Custom Extension. Предыдущие мутации не ломаются при добавлении новой. Все изменения карт, спрайтов, мутаций и контента выполняются только через интерфейс редактора; создание доверенного расширения как исходного кода — отдельная процедура разработки, после которой настройки становятся доступны редактору.

## 2. Обязательная защита редактора

### 2.1. `.env` — только сервер

`.env.example` (заполнить секрет отдельно):

```dotenv
# Секрет администратора. Генерировать не менее 32 криптографически случайных байт.
ADMIN_EDITOR_TOKEN=<REPLACE_WITH_RANDOM_BASE64URL_TOKEN>
# Не коммитить .env в Git. Для production использовать secret manager.
EDITOR_SESSION_TTL_SECONDS=28800
EDITOR_SESSION_IDLE_SECONDS=1800
EDITOR_AUTH_MAX_ATTEMPTS=5
EDITOR_AUTH_WINDOW_SECONDS=900
EDITOR_ALLOWED_ORIGIN=https://example.com
NODE_ENV=production
```

Сгенерировать токен локально через `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` либо аналогичную команду. **Никогда** не использовать `VITE_ADMIN_EDITOR_TOKEN`, `NEXT_PUBLIC_ADMIN_EDITOR_TOKEN`, `PUBLIC_*`, `import.meta.env` в клиентском коде для секрета. Vite экспортирует `VITE_` значения в браузерную сборку: https://vite.dev/guide/env-and-mode.

Старт backend в production **должен завершаться ошибкой**, если `ADMIN_EDITOR_TOKEN` отсутствует, является плейсхолдером или недостаточно длинный.

### 2.2. Поток аутентификации

```text
GET  /editor ──(без сессии)──> /editor/login
                                    │
                                    ▼
                        POST /api/editor/auth/login
                        { token: 'введенный секрет' }
                                    │
                         HTTPS → Fastify server
                                    │
                        hash + constant-time compare
                                    │
             ┌───────── invalid ────┴──── valid ───────────┐
             ▼                                             ▼
       401 + rate limit                           server session store
                                                           │
                                               Set-Cookie: __Host-editor_sid
                                               HttpOnly; Secure; SameSite=Strict; Path=/
                                                           │
                                                        /editor
```

- Браузер отправляет токен **однократно** через защищенный POST, а затем использует HttpOnly cookie; не хранить raw token в localStorage, sessionStorage, URL query/hash, логах или analytics.
- Сервер хранит только криптографический хэш случайного идентификатора сессии; TTL и отзыв реализовать через Redis или PostgreSQL. Для однопроцессного dev можно in-memory, **не** для production с несколькими экземплярами.
- Проверять переданный токен в постоянное время (например, SHA-256 обоих значений + `timingSafeEqual`, при равной фиксированной длине digest).
- Сравнение секретов и логин доступны только серверному маршруту. При неверном секрете — одинаковый текст ошибки, rate limit по IP и иным безопасным ключам, аудит без секрета.
- Ограничить попытки и защитить от перебора; для публично доступного редактора рекомендованы дополнительно VPN/allowlist IP или SSO/MFA через внешний identity proxy.
- Все state-changing запросы защищать CSRF-токеном и проверкой `Origin`/Fetch Metadata. `SameSite=Strict` — дополнительный рубеж, не единственная защита.
- Cookie использовать только по HTTPS, кроме отдельно настроенной local-dev среды `localhost`.
- При логине пересоздавать session ID; при выходе отзывать сессию; при смене `ADMIN_EDITOR_TOKEN` отзывать активные сессии через epoch/sessionVersion.
- Не раскрывать секрет, хэши или сырой токен в `/api/editor/session`.
- Административные события писать в `audit_logs` с action, timestamp, requestId, ресурсом, diff/hash и статусом; не писать чувствительные поля.

### 2.3. Проверка разрешений на КАЖДОМ запросе

Серверная middleware `requireEditorAdminSession` применяется к:

- `GET /editor` и маршрутам editor shell, если нужна полная закрытость интерфейса;
- `GET/POST/PATCH/DELETE /api/editor/*`;
- импорту ZIP и загрузке приватных изображений/файлов;
- генерации превью приватных черновиков;
- экспорту черновиков;
- публикации и откату публикации;
- WebSocket каналам административного редактора (авторизация на handshake и перепроверка сессии).

**Не защищать игровые маршруты этим токеном** и **не выдавать его игровым клиентам**. Для публичной игры используется отдельная система игроков и UID.

Проверка доступа только в React (`useAuth`/redirect) недостаточна. Если editor shell обслуживается чистым Vite static hosting, закрыть `/editor` на gateway/SSR/сервере либо разместить за auth reverse proxy; защита только `/api/editor/*` сохраняет данные, но не делает сам URL и клиентский JS закрытыми.

### 2.4. Минимальные API редактора

| Метод | Маршрут | Доступ | Назначение |
|---|---|---|---|
| POST | `/api/editor/auth/login` | Public, rate limited | Проверить токен, создать сессию |
| POST | `/api/editor/auth/logout` | Admin + CSRF | Отозвать сессию |
| GET | `/api/editor/session` | Admin | Проверить сессию без выдачи токена |
| GET | `/api/editor/extensions` | Admin | Список проверенных расширений и UI Schema |
| POST | `/api/editor/mutations/validate` | Admin + CSRF | Проверить данные мутации |
| POST | `/api/editor/mutations/preview` | Admin + CSRF | Запустить ограниченный тест на доверенной симуляции |
| PUT | `/api/editor/projects/:id` | Admin + CSRF | Сохранить черновик |
| POST | `/api/editor/projects/:id/import` | Admin + CSRF | Импорт ZIP |
| POST | `/api/editor/projects/:id/export` | Admin + CSRF | Экспорт JSON + ассеты |
| POST | `/api/editor/projects/:id/publish` | Admin + CSRF | Публикация версии |

Защита распространяется на доступ к объектам через ID: нельзя получить чужие/закрытые черновики через публичный файловый URL. Для приватных ассетов использовать авторизованную загрузку или короткоживущие подписанные URL.

## 3. Матрица ответственности и обновлений

| Изменение | Editor | JSON | TS extension | Пересборка runtime |
|---|---:|---:|---:|---:|
| +20% скорость персонажа | Да | Да | Нет | Нет |
| Шанс отравления при попадании | Да | Да | Нет, если триггер/эффект есть | Нет |
| Увеличение радиуса взрыва | Да | Да | Нет | Нет |
| Электрическая цепь по врагам | Да | Да | Да, если обработчика нет | Да, один раз |
| Изменить урон электрической цепи | Да | Да | Нет | Нет |
| Новая механика порталов для снарядов | Да | Да | Да | Да |

**Граница:** нельзя обещать подключение *произвольного* нового алгоритма одним JSON без поддержки исполнения кода. Выбранный безопасный путь — доверенный расширяемый SDK с автогенерацией инспектора и реестра.

## 4. Рекомендации по технологиям

### 4.1. Единая симуляция для Game + Editor

- Рекомендация: TypeScript deterministic simulation (`packages/simulation`) без Phaser и DOM.
- Phaser — только графика/ввод/камера; Fastify/Node — authoritative simulation.
- Редактор запускает `simulation` локально в `Web Worker` для быстрого preview, сервер запускает тот же пакет для настоящего забега. Worker не является надежной песочницей для непроверенного кода.
- Отладочное сравнение состояния и replay должны выявлять расхождения между браузером и сервером.

### 4.2. JSON Schema и UI Schema отдельно

- `params.schema.json` — типы, обязательные поля, диапазоны, `additionalProperties: false`.
- `editor.schema.json` — слайдеры, цвета, подбор ссылок, секции, help, виджеты.
- Ajv 2020 используется для валидации на API, при сборке и в редакторе; полезна генерация standalone validators при сборке для уменьшения загрузки runtime: https://ajv.js.org/standalone.html.
- Проверять ссылки (`spriteId`, `damageTypeId`, `vfxId`) отдельным cross-reference validator, а не только по JSON Schema.

### 4.3. Контролируемое расширение механик

- `MutationExtension` — типизированный API с узким `MutationContext`, без доступа к `World` напрямую.
- `EventBus` + очереди команд, а не прямое изменение компонентов игры обработчиком.
- `extension.json` + генерация статического реестра на этапе сборки; никаких `eval` и динамических модулей из ZIP.
- Тяжелые расчеты и previews можно изолировать в Worker/worker thread и вводить тайм-ауты; **для защиты от враждебного кода нужна процессная/контейнерная изоляция**. Административный AI-код всегда проходит проверку.

### 4.4. Детерминизм и multiplayer

- Не рассчитывать cooldown по клиентскому wall-clock; хранить `readyTick`.
- Использовать seed RNG, заданный порядок событий, явно оговоренные правила floating-point/fixed-point.
- Обязательно кодировать происхождение эффектов и лимиты proc chain; иначе мутации «при убийстве» могут бесконечно порождать сами себя.
- Контент-пак и реестр расширений фиксируются на каждый забег. При несовместимой версии сохранение не загружается без миграции.
- В сетевых пакетах можно пересылать чисто визуальные события мутации вместо полной повторной симуляции эффектов у клиента.

### 4.5. Хранение и публикация

- PostgreSQL хранит профили, черновики (метаданные/версии), ревизии публикаций и аудит.
- Redis хранит краткоживущие admin sessions, живые лобби и координационные записи (но не должен быть единственным хранилищем забегов).
- S3-совместимое объектное хранилище хранит версии ZIP и ассеты, content packs — immutable.
- Манифест должен содержать `engineVersion`, `contentVersion`, `schemaVersion`, `requiredExtensions: [{id, version}]`, checksums.

### 4.6. Рекомендуемые UI-инструменты

- React + TypeScript + Vite для закрытого редактора.
- React Flow / `@xyflow/react` для графа событий, условий и действий (сохранять семантический JSON, не зависеть в runtime от структуры React-компонентов).
- PixiJS или Phaser для canvas-превью: **лучше Phaser**, если он уже используется игровым клиентом; не вводить второй рендерер без необходимости.
- Monaco Editor как опциональный JSON/Schema просмотр; по умолчанию для создания мутации показывать визуальные формы.
- TanStack Query для состояния серверных запросов; Zustand или локальный reducer для истории редактирования; Undo/Redo основан на командах/патчах.
- Vitest для модульных/replay тестов, Playwright для E2E редактора и сценария авторизации.

### 4.7. DevOps и безопасность поставки

- pnpm workspaces + Turborepo (опционально) для монорепозитория.
- Docker Compose для локального окружения; контейнерный хостинг с долговременными процессами для WebSocket/симуляции.
- GitHub Actions CI: schemas → types → lint → unit → replay → E2E smoke → build → security check → publish.
- Загруженные ZIP проверяются по лимиту размера, глубине, распакованному размеру, путям и MIME. Публикация только после проверки и ревью.
- `ADMIN_EDITOR_TOKEN` не хранится в Git. Для production — секрет в хостинговом secret manager, внедренный как серверная env переменная.

## 5. Изменение структуры репозитория

```text
apps/
  game-client/
  editor/                                # /editor/login, /editor, mutation UI
  server/                                # Fastify API, editor auth, game sim
packages/
  simulation/                            # headless deterministic engine
  mutation-sdk/                          # типизированный контекст и контракт
  mutation-engine/                       # события, state, limits, proc chain
  mutation-extensions/                   # доверенные обработчики
  content-schemas/                       # JSON Schema + cross refs
  content-loader/                        # разрешение и проверка ссылок
  content-pack-builder/                  # экспорт ZIP + checksums
  editor-components/
  multiplayer-protocol/
content/
  base-game/effects/mutations.json
  base-game/effects/effect-definitions.json
  base-game/effects/custom-effect-types.json
scripts/
  mutation-create.ts
  generate-extension-registry.ts
  content-validate.ts
docs/
  CUSTOM_MUTATION_PIPELINE.md
  EDITOR_SECURITY_AND_ARCHITECTURE.md
.env.example
```

## 6. Приемка новых требований

- [ ] Публичный пользователь без админ-сессии получает 401/redirect от `/editor` и 401/403 от редакторских API.
- [ ] Токен задается только как `ADMIN_EDITOR_TOKEN` на сервере. Его нельзя найти в JS bundle, web storage, URL или ответах API.
- [ ] При верном токене устанавливается защищенная сессия; неверные попытки ограничены.
- [ ] Logout и ротация токена отзывают сессии, истечение сессии работает.
- [ ] Весь редактор (включая preview, import/export, publish и доступ к private assets) авторизован на backend.
- [ ] Мутация Built-in создается в редакторе без изменения кода.
- [ ] Комбинированная мутация создается через граф и экспортируется в JSON.
- [ ] Custom Extension после однократной сборки автоматически появляется в каталоге редактора.
- [ ] Параметры и ассеты Custom Extension меняются в редакторе без нового изменения TS.
- [ ] Срабатывание кастомного эффекта реализовано сервером, корректно синхронизируется, сохраняется, восстанавливается.
- [ ] Импорт ZIP с неизвестным `extensionId` отклоняется с понятной ошибкой.
- [ ] AI-сгенерированный код без проверки не выполняется и не публикуется.

## 7. Риски и осознанные компромиссы

1. **Статический хостинг:** защита только API достаточна для данных, но не для полного сокрытия редактора. Для требования «редактор закрыт токеном» использовать backend reverse proxy для HTML, UI и API.
2. **Токен вместо аккаунта:** для одного администратора реализуемо, но это единый секрет без персональной идентификации. При росте команды переходить на отдельные admin accounts/SSO + MFA + RBAC.
3. **Кастомный TS против JSON:** полная произвольность кода несовместима с безопасной загрузкой ZIP. Доверенный build-time SDK — сознательный компромисс между гибкостью и безопасностью.
4. **Миграции:** произвольные изменения формы state или логики эффектов могут сломать сохранения; требовать version pin и миграции.
5. **Редакторский preview:** совпадение поведения достигается общей симуляцией; отрисовка и задержки сети могут отличаться. Нужны replay тесты на сервере.

## 8. Источники для технологических решений

- Vite, публикация env в клиент: https://vite.dev/guide/env-and-mode
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- MDN Session Management: https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Session_management
- Ajv standalone validation: https://ajv.js.org/standalone.html

## 9. Обязательное дополнение: покадровые анимации персонажей

Добавить в защищенный `/editor` **Animation Studio**, который принимает последовательности кадров (отдельные PNG/WebP или spritesheet), позволяет создавать/переупорядочивать кадры на timeline, задавать длительности, pivot, offsets и loop, смотреть результат в режиме pixel-perfect и тестировать переходы между состояниями. Для каждого игрового персонажа обязательны **пять состояний: `idle`, `run`, `hurt`, `death`, `victory`**. Смерть и победа — одноразовые анимации; бег и покой — циклические; получение урона — краткая одноразовая реакция.

Разделить обязанности JSON: `visuals/sprites.json` — изображения и фреймы, `visuals/animations.json` — упорядоченные последовательности, `entities/characters.json` — назначение клипов состояниям через `animationSet`. Оставить редактор доступным только администратору из серверного `ADMIN_EDITOR_TOKEN`; приватные кадры черновиков не выдавать без проверки сессии. Игровые клиенты получают только опубликованные версии ресурсов.

**Полная спецификация, примеры форматов, пайплайн разработки и чек-лист:** `docs/CHARACTER_ANIMATION_PIPELINE.md`. Добавить этот документ в репозиторий и критерии приемки основного проекта.


## 10. Обязательное дополнение: звук, частицы, настройки и загрузка файлов

Полный нормативный документ: [`AUDIO_PARTICLES_SETTINGS_PIPELINE.md`](./AUDIO_PARTICLES_SETTINGS_PIPELINE.md). Этот раздел расширяет, но не отменяет положения разделов 1–9.

### 10.1. Новые инструменты в `/editor`

- `Sound Library` + `Sound Inspector`: импорт/просмотр/тестирование звуковых эффектов, ограничение частоты/полифонии, громкость, pitch, spatial audio.
- `Music Library` + `Playlist Editor`: отдельные фоновые треки, loop, fade, crossfade, музыка меню/биома/босса/победы.
- `Particle Lab`: отдельная система эмиттеров, импорт спрайтов, burst/continuous, скорость и направление, ускорение/гравитация/drag, вращение, размер и прозрачность по времени, коллизии, объектный пул, живой предпросмотр.
- `Camera Effects`: shake preset с силой/частотой/длительностью, не влияющий на gameplay.
- `Event Binding Builder`: типизированные условия запуска `play_sfx`, `spawn_particles`, `camera_effect`, `switch_music` по событиям игры; использовать тот же роутер в Weapon/Character/Enemy/Boss/Mutation/Animation Editor.
- `AssetDropzone` + `AssetImportQueue`: единая очередь drag-and-drop для PNG/WebP/WAV/OGG/MP3/ZIP; валидировать MIME, размеры, хэш и количество файлов; preview, retry, cancel, progress, keyboard fallback.

### 10.2. Новые форматы файлов

```text
config/user-settings.defaults.json
visuals/particles.json
visuals/camera-effects.json
audio/sounds.json
audio/music.json
triggers/event-bindings.json
```

`manifest.json` должен перечислять файлы и проверять хэши ассетов. Индивидуальные пользовательские настройки и сохранения не включать в контент-пак.

### 10.3. Защита редактора распространяется на новые маршруты

`requireEditorAdminSession` + CSRF + audit log обязательны для просмотра приватных ресурсов и любых операций `/api/editor/assets*`, `/api/editor/audio*`, `/api/editor/particles*`, `/api/editor/triggers*` и публикации. Прямой URL в private bucket не может обходить проверку администратора.

### 10.4. Игровое меню — отдельная область прав

Пользователь игры изменяет `sfxVolume`, `musicVolume`, `screenShakeStrength`, `muteSfx`, `muteMusic`, `reducedMotion`, `particleQuality` через собственное меню. Эти параметры хранятся по UID через `GET/PATCH /api/users/me/settings`, а **не** в глобальных JSON контента. Для кнопки «Сбросить сохранения» предусмотреть явное подтверждение и серверный `POST /api/users/me/progress/reset`. По умолчанию сбрасывается только прогресс/сохранения, но сохраняются UID и историческая статистика/лидерборды; активную кооперативную сессию нельзя уничтожать этой кнопкой.

### 10.5. Не ломать существующую архитектуру мутаций и анимаций

События `spawn_cosmetic_particle`, `play_local_sound`, `camera_shake_local` в `animations.json` должны делегировать исполнение независимому `PresentationEventRouter`. Custom Mutation SDK публикует типизированные cosmetic event commands и никогда не создает Phaser particle emitter внутри обработчика. Сервер принимает игровые решения, клиент отображает VFX/SFX.

### 10.6. Definition of Done

- [ ] Добавленные звук и частицы воспроизводятся по настроенному событию после экспорта/импорта.
- [ ] У пользователя работают независимые громкости SFX и BGM и сила тряски.
- [ ] Сброс сохранений удаляет только подтвержденный прогресс и не изменяет рекорды или чужие данные.
- [ ] Все поля Particle Lab обновляют предпросмотр в реальном времени.
- [ ] Drag-and-drop поддерживается во всех медиа-редакторах и импортирует последовательности кадров в правильном порядке.
- [ ] Приватные ассеты не доступны неавторизованным посетителям.
- [ ] Тесты валидируют несовпадающие ссылки, сетевые дубли событий, лимиты частиц, отказоустойчивость импорта и очистку ресурсов.


## 11. Обязательное дополнение: мир, противники, награды и открытие персонажей

Полная нормативная спецификация: [`WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md`](./WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md). Добавить файл в репозиторий рядом с остальными пайплайнами.

- **Decoration Studio:** загрузка и размещение декораций, вероятность/веса спавна, коллайдеры, разрушение от разных видов оружия, проверка проходимости после генерации. Данные: `entities/props.json` + `world/decoration-spawn-tables.json`.
- **Chests & Rewards Studio:** типы сундуков, частота появления, гарантированные и вероятностные награды, лут из врагов с зависимостью от `difficultyRating`; разнести `world/chests.json`, `world/chest-spawn-tables.json`, `world/drop-rules.json`, `world/loot-tables.json`.
- **Enemy Studio / Boss Studio:** отдельные UI-разделы, разные размеры/коллайдеры, анимации и фазы, опциональная `windup` анимация перед выстрелом, серверный тайминг. Боссам — фазы и паттерны атак.
- **SFX/VFX/Camera:** любые события `enemy.attack_windup_started`, `boss.phase_changed`, `prop.destroyed`, `chest.opened`, `loot.spawned` обрабатываются **только через** `PresentationEventRouter` и `triggers/event-bindings.json`. Все shaking presets лежат в `visuals/camera-effects.json`; пользовательский `screenShakeStrength` один для всех событий.
- **Character Unlock Studio:** правила `world/unlock-rules.json` (завершение уровня/биома, победа над боссом, solo/coop, `single_run` или `account`), серверная оценка, таблица `user_character_unlocks` по UID, идиемпотентное подтверждение; стандартный «Сброс сохранений» сохраняет открытых персонажей.
- **Auth:** все новые маршруты `/api/editor/props*`, `/chests*`, `/enemies*`, `/bosses*`, `/unlocks*`, `/rewards*` под `/api/editor/` требуют серверной admin-session, CSRF и audit log; приватные загруженные ассеты не публичные.

**Критерий готовности:** администратор может настроить предмет декорации и его частоту появления, создать сундук, назначить дроп врагу, создать разнокалиберного врага или босса с опциональным windup, выбрать SFX/VFX/camera preset для событий и открыть персонажа за пройденный биом — все через UI, без ручного редактирования JSON, с сохранением в опубликованный контент-пак и проверкой в игровой симуляции.

## 12. Обязательное дополнение: профессиональный интерактивный UI/UX и редакторы уровней

**Нормативные документы:** `EDITOR_UI_UX_INTERACTION_SPEC.md` и `LEVEL_AND_CAMPAIGN_EDITOR.md`. Это части той же системы `/editor`, а не второе отдельное приложение.

### 12.1. UX Shell

- Реализовать вкладки объектов и инструментов, перетаскиваемые/dockable окна, floating panels, сворачивание, максимизацию, splitter resizing, сохранение layout, предустановленные рабочие пространства; `dockview-react` — рекомендуемый кандидат.
- Всегда давать осмысленную обратную связь: outline принимающей зоны при drag-and-drop, drag ghost, correct cursor (`grab`, `grabbing`, `not-allowed`, `crosshair`, `col-resize`), toasts, inline-errors, понятные loading states, keyboard Undo/Redo.
- Верхняя интерактивная `ContextHelpBar` объясняет выделенный инструмент, изменяемое поле, единицу, диапазон и доступные связи. Источники tooltip — типизированная UI Schema и FieldHelpRegistry, не hardcoded текст в каждом компоненте.
- Каждая вкладка редактора использует общий `SimulationWorkbench` для изолированного preview (персонажи, анимации, оружие, частицы, звук, сундуки, враги/боссы, карты); предпросмотр никогда не меняет реальные профили и рейтинги.
- Отдельная панель `Event Logic Studio` соединяет типизированные события, условия и действия через графические порты; узлы сериализуются в схемы EffectEngine/PresentationEventRouter/AI. Произвольный JS в JSON запрещен.
- Обязательны реальные индикаторы `Uploading → Verifying → Decoding → Linking → Done`, retry/cancel, error recovery, дедупликация и безопасное восстановление после сбоя загрузки.

### 12.2. Map/sequence architecture

- Level Studio: независимый визуальный редактор тайлов пола/стен, autotiles, слоев, фиксированных и случайных placement сущностей, collision/navmesh/spawn zones, генератора и тестовых seed-сцен.
- Campaign Studio: отдельный редактор порядка уровней/биомов с ветвлениями, boss nodes, альтернативными маршрутами, правилами переходов, difficulty curve и ссылками на `unlock-rules.json`.
- Расширить `world/*.json`: `tile-palettes.json`, `tilemaps.json`, `levels.json`, `level-sequences.json` + существующие `room-templates.json`, `generation-rules.json` и spawn/loot definitions. Новые схемы/хэши зарегистрировать в manifest, refs валидировать.
- Положение окон, курсора и узлов редактора хранить **в UI metadata**, не в исполняемом контент-паке. Игровой сервер получает только semantic data.

### 12.3. Security и изоляция

Новые маршруты `/editor/level/:levelId`, `/editor/campaign/:sequenceId`, preview, stage simulation, render assets, сохранение UI layout и batch uploads наследуют `requireEditorAdminSession` с привязанной к `ADMIN_EDITOR_TOKEN` серверной админ-сессией и проверкой CSRF на изменяющих операциях. Никаких публичных API, отдающих приватные tilemaps, graphs или черновики. Изолированные sandbox previews не записывают результаты в `player_stats`, `game_runs` или unlock-таблицы.

### 12.4. Acceptance

- Панели корректно докуются/открепляются/сворачиваются и восстанавливаются.
- Все новые графы/карты редактируются визуально, имеют Undo/Redo и inline validation.
- После импорта floor/wall tiles пользователь рисует уровень, создает последовательность биомов и боссов, проверяет достижимость и публикует все данные через проверенный ZIP.
- Публикация требует целостности схем/ссылок/версий; изолированные тесты и новый content workflow не обходят security.

## 13. Независимая инструкция для ИИ-графики

`AI_PIXEL_ART_GENERATION_GUIDE.md` — самостоятельный документ для отдельной графической модели/художника. Он описывает pixel grid, размеры, alpha, спрайты, бесшовные тайлы пола/стен, обязательные анимации idle/run/hurt/death/victory, optional windup, графику сундуков, частиц, оружия и metadata sidecars. Сам документ не исполняется как JSON/schema; сгенерированные ассеты проходят безопасный импорт, проверку размеров, очистку pixel art и привязку к runtime ID через editor.
