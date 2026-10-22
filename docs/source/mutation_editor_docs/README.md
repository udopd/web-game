# Комплект технического задания Pixel Roguelike + Visual Game Editor

Документы расширяют мастер-промпт на создание оригинальной браузерной 2D pixel roguelike-игры и защищенного визуального редактора. Приоритет: **визуальный редактор как источник управляемого игрового контента**, JSON Schema/immutable packs, server-authoritative simulation, совместимая система событий и расширяемый SDK.

## Состав

| Документ | Ответственность |
|---|---|
| `EDITOR_SECURITY_AND_ARCHITECTURE.md` | Архитектура, защита по токену из серверного `.env`, API, изоляция preview |
| `EDITOR_UI_UX_INTERACTION_SPEC.md` | **Новое:** минималистичный UI, docking/windows, draggable tabs, tooltip bar, граф событий, общий preview, microinteractions и upload UX |
| `LEVEL_AND_CAMPAIGN_EDITOR.md` | **Новое:** редактор отдельных уровней, тайлов и карт; редактор последовательности биомов/боссов, JSON и test pipeline |
| `AI_PIXEL_ART_GENERATION_GUIDE.md` | **Новое, независимое:** полный промпт для ИИ-художника и технический стандарт всех спрайтов, тайлов, анимаций, частиц, оружия, сундуков |
| `CUSTOM_MUTATION_PIPELINE.md` | Custom Mutation SDK, конфигурации, написание обработчиков при помощи ИИ |
| `AI_MUTATION_TASK_TEMPLATE.md` | Шаблон задачи ИИ на новую мутацию |
| `CHARACTER_ANIMATION_PIPELINE.md` | Sprite/animation system, idle/run/hurt/death/victory/windup |
| `AUDIO_PARTICLES_SETTINGS_PIPELINE.md` | Звуки, музыка, Particle Lab, Camera Shake, настройки и общая загрузка ресурсов |
| `WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md` | Props, разрушаемость, сундуки, дроп, Enemy/Boss Studio, unlock characters |

## В каком порядке передавать другой нейросети

1. Мастер-промпт игры из основного обсуждения.
2. `EDITOR_SECURITY_AND_ARCHITECTURE.md` — установить границы систем и безопасность.
3. `EDITOR_UI_UX_INTERACTION_SPEC.md` — разработать оболочку редактора и UX-компоненты.
4. `LEVEL_AND_CAMPAIGN_EDITOR.md` — спроектировать карту и прогрессию.
5. `WORLD_CONTENT_AND_UNLOCKS_PIPELINE.md`, `CHARACTER_ANIMATION_PIPELINE.md`, `AUDIO_PARTICLES_SETTINGS_PIPELINE.md` — интегрировать game content.
6. `CUSTOM_MUTATION_PIPELINE.md`, `AI_MUTATION_TASK_TEMPLATE.md` — расширение мутаций.
7. `AI_PIXEL_ART_GENERATION_GUIDE.md` — независимо передать ИИ-генератору изображений или техническому художнику; получившиеся ассеты импортировать в защищенный редактор.

## Правила совместимости

- Данные игры из `world/*.json`, `visuals/*.json`, `entities/*.json`, `audio/*.json`, `triggers/*.json`, `effects/*.json` валидируются, связываются по ID, экспортируются с `manifest.json` и SHA-256; финальные gameplay state и unlocks рассчитываются сервером.
- Интерфейсные позиции панелей и graph layout — **только данные редактора**, не runtime JSON; при необходимости исходники редактора можно экспортировать отдельно.
- Реализуется **единый** `SimulationWorkbench`, `EventBus/PresentationEventRouter`, `AssetImporter`, `CameraEffectSystem` вместо дублей в разных вкладках.
- Отдельный материал для ИИ-графики — **описание генерации**, а не комплект готовых изображений.
- Примеры JSON в документации иллюстрируют структуру; реальные полноформатные JSON Schema и TypeScript contracts должны быть реализованы разработчиком как часть проекта. При расхождении названий полей окончательным источником истины являются версия JSON Schema и схемы общего реестра после интеграционной проверки.

## Критерий общего результата

Администратор авторизуется → импортирует PNG по drag-and-drop → создает тайлы и анимации → рисует карту с врагами/декорациями/сундуком → строит цепочку уровней и босса → связывает события со звуками/частицами → испытывает в preview → проверяет JSON/ссылки/версию → экспортирует ZIP → публикует immutable content pack → игровая серверная симуляция загружает и использует новую версию при старте нового забега.
