# Emberfall — объединённая спецификация

Дата сверки: 2026-10-22. Все десять исходных документов и MASTER_EXECUTION_PROMPT полностью прочитаны. Исходники сохранены без изменений в `docs/source/`. Это полный производственный проект; промежуточная реализация не равна выполнению Definition of Done.

## Нормативный реестр

`REQUIREMENTS_MATRIX.md` содержит атомарные записи с исходными строками, ответственностью, реализацией, проверкой и статусом. Содержимое исходных контрактов сохраняется в документах: ссылки матрицы обязательны, а не факультативны. Ни одна неподтверждённая функция не получает статус verified.

## Приложения и зависимости

Game Client (React shell + Phaser 3) → presentation + shared-types + multiplayer-protocol.
Editor (React/Vite + Dockview + XYFlow) → editor-components + content-schemas + SimulationWorkbench.
Fastify → content-loader + simulation + PostgreSQL/Prisma + S3 storage.
Simulation → game-core + procedural-generation + ai-engine + effect-engine + mutation-sdk + event-system.
ContentRegistry → content-schemas → shared-types. Схемы TypeBox являются источником типов и экспортируются в JSON Schema draft 2020-12.
Ни simulation, ни расширения не импортируют React, Phaser, DOM, сеть, БД или secrets. Серверные модули не импортируются браузерными entry points.

## Единые решения

* Schema/content/engine versions разделены. Коллекция: `{schemaVersion:"1.0.0",items:[]}`. Manifest перечисляет runtime-файлы и SHA-256, engineVersion, contentVersion, requiredExtensions. Проверяются ID, ссылки, geometry, graphs и ресурсы.
* `animationSet` — каноническое имя; устаревшее `animations` мигрируется явным конвертером. `spriteId` всегда ссылка, пути изображений только в sprites. Pivot в логических пикселях; размеры коллайдера независимы от render scale.
* Fixed-step 30 Hz. В gameplay все задержки целочисленные ticks; UI переводит ms через ceil(ms*30/1000). Графика и звук используют ms, не влияют на combat.
* `entity.killed` — общее событие; enemy/boss/prop события имеют специализированный тип. Нельзя учитывать общее и специализированное событие как две смерти. Event IDs: run/tick/sequence. RNG мира, боя, дропа и косметики разделены.
* Одна очередь команд, один EventBus, один EffectEngine, один PresentationEventRouter. Декларативные графы компилируются в доверенные операции с лимитами, не исполняют код из JSON.
* Все три режима мутаций обязательны. Custom TS регистрируется генератором при доверенной сборке; JSON хранит параметры и exact extension version. Интерфейс SDK не считается песочницей для чужого кода.
* Отдельные определения персонажей, врагов, боссов, props, chests, оружия, снарядов, beams, атак, AI, анимаций, SFX, музыки, частиц, камеры, миров, кампаний, rewards, progression. Уровень ссылается на определения и не копирует stats.
* Render/UI layout никогда не определяет gameplay. Layout Dockview, позиции графов, selection, locks и opacity хранятся в UI metadata отдельно от runtime ZIP.
* Draft revisions используют optimistic locking; публикация атомарна, immutable. Каждый забег фиксирует content hash; rollback меняет указатель текущей версии, не изменяет архивы.
* Cookie-сессии разделены для игрока и администратора. Секрет администратора только server env. Хеши сессий в PostgreSQL, absolute/idle TTL, token epoch, Origin + CSRF, rate limit, audit. Production требует HTTPS. Локальный HTTP допускается только localhost.
* Стандартный Reset Save сохраняет UID, исторические stats, настройки и permanent unlocks. Противоречащий текст AUDIO §5.3 про удаление unlocks заменён более поздним явным WORLD §9.4. Активный coop блокирует reset.
* Полный продукт не использует упрощения «MVP» из ранних документов. Multipart допускается лишь как документированный ограниченный transport; resume не заявляется без upload sessions.
* Runtime размещается на постоянном Node-сервере. Redis необязателен для одного процесса; PostgreSQL хранит checkpoints и sessions. S3 хранит приватные ассеты и immutable packs; доступ публичен только к опубликованным файлам через проверенный manifest.

## Полная функциональная область

Редактор: проекты, версии, 17 специализированных студий из MASTER §6, Asset Manager, Animation Timeline, Weapon/Projectile/Beam/Hitbox инструменты, Mutation Designer/Graph/Extension catalog, Enemy AI, Boss phases, Particle curves, Audio waveform/playlists, Camera preview, Props, Chests/Loot/Difficulty, Unlock tree, Level paint/layers/autotile/spawn/nav overlays и Campaign graph/list/branch simulation. Обязательны docking, floating, presets, undo/redo, autosave, search, help registry, RU/EN, keyboard/touch, accessibility, validation и isolated previews.

Игровой runtime: solo и coop 2–4, движение/aim, пять разных классов оружия, projectile physics/beam raycasts/melee volumes, damage/statuses/mutations/XP, pickups/chests/props, AI/navigation/windup, boss phases, handcrafted/procedural/hybrid worlds, campaign branches/endless, progression/unlocks, смерть/победа/перезапуск. Стартовый оригинальный набор демонстрирует все системы и несколько биомов.

Backend: UID registration и защищённая сессия; player profile/settings/history/saves; room ready/start/kick/transfer/reconnect; authoritative input-only protocol; atomic idempotent checkpoints/results/unlocks; leaderboards kills/depth. Editor CRUD/import/export/publish/private assets/preview/auth/audit. Все статистические решения только серверные.

Media: безопасная очередь импорта, содержимое/MIME/dimensions/duration/hash, лимиты ZIP/CPU, защищённые private assets, естественная сортировка кадров. Общие audio/music/particle/camera/animation modules, local settings and reduced motion, dedupe events, bounded pools and disposal. Original art provenance and pixel QA обязательны.

## Источники подсистем

Security/API/content packs: EDITOR_SECURITY_AND_ARCHITECTURE. UX/design/docks/help/graphs: EDITOR_UI_UX_INTERACTION_SPEC. Levels/campaigns: LEVEL_AND_CAMPAIGN_EDITOR. AI/boss/props/rewards/unlocks: WORLD_CONTENT_AND_UNLOCKS_PIPELINE. Animation: CHARACTER_ANIMATION_PIPELINE. Audio/VFX/settings/import: AUDIO_PARTICLES_SETTINGS_PIPELINE. SDK: CUSTOM_MUTATION_PIPELINE и AI_MUTATION_TASK_TEMPLATE. Art: AI_PIXEL_ART_GENERATION_GUIDE. Deployment/game/network/QA: MASTER_EXECUTION_PROMPT. README исходников задаёт правила совместимости.

## Приёмка

Все сценарии A–F подтверждаются integration/E2E; multiplayer проверяется двумя независимыми клиентами одного сервера. Typecheck/build/unit/replay/schema/security/integration/E2E/performance/Docker обязательны. Статусы и фактический вывод тестов фиксируются в TESTING и матрице. Наличие кода или успешный build сами по себе не означают готовность.
