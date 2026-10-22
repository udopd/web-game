# Полный план производства

Каждый этап — часть полного продукта. Проверки и документация обновляются после завершения блока. Невыполненное остаётся явно открытым.

| Этап | Работы | Зависимости | Критерий завершения / проверка |
|---|---|---|---|
| 1 | Реестр всех источников, unified spec, решения конфликтов, monorepo | исходный архив | трассировка всех нормативных атомов |
| 2 | Строгие схемы всех доменов, generated JSON Schema, TS, refs/graphs/maps validators, manifest/packs | 1 | positive/negative + ZIP roundtrip/hash/traversal tests |
| 3 | RNG, события, fixed step, combat, projectile/beam/melee, AI/pathing/windup/boss, loot/props/chest, generation/campaign | 2 | unit, deterministic replay, seed batches |
| 4 | EffectEngine, graph interpreter, SDK/lifecycle/state/limits, trusted registry and CLI | 2–3 | custom extension edge cases/save/replay |
| 5 | PostgreSQL schema/migrations, sessions/CSRF/audit, S3 assets, drafts/publish, profiles/settings/saves | 2 | real database API integration/security tests |
| 6 | WebSocket lobby, ownership/ready/kick/reconnect, pinned runs/checkpoints/results/unlocks | 3–5 | two clients, death, level finish, transfer, reconnect |
| 7 | Editor design tokens, dock shell/persistence, command store/history/help/search/import/validation | 2,5 | auth + edit/save/reopen + docking E2E |
| 8 | Animation, assets, character, weapon, projectile/beam/melee specialized tools and shared workbench | 3,7 | сценарий A, timeline roundtrip |
| 9 | Mutation/graph/extension tools, Enemy/Boss/AI studios | 4,7–8 | сценарии B/C/D |
| 10 | Particle curves, audio/music, camera, bindings; actual presentation modules | 3,7 | event dedupe/settings/disposal + UI previews |
| 11 | Props/chests/drops/unlocks; Level paint/autotile/layers/zones, Campaign branches/list | 3,7 | сценарий E + seed/distribution tests |
| 12 | Game menu/registration/selection/lobby/settings/rankings, Phaser renderer/input/interpolation | 6,8,10 | game browser E2E + сценарий F |
| 13 | Original sprites/animations/tiles/audio/content pack, multi-biome playthrough and balancing | 8–12 | art QA + full solo/coop campaign |
| 14 | Accessibility RU/EN/touch, performance/failure testing, production Docker/healthchecks/CI/docs | все | полная матрица DoD подтверждена |

Риски: доступ npm/Docker/browser; генерация точных pixel animation frames; большое число связей/схем; persistence races; CPU budget previews; лицензии библиотек; полноценная ручная UX/игровая приёмка. Изменения формата обновляют schemas/types/tests/docs вместе. Все публичные и приватные ресурсы имеют разные границы доступа.
