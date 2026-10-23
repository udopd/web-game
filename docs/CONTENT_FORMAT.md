# Формат контента

Источник контрактов: `packages/content-schemas/src/definitions.ts`. Экспортированные схемы находятся в соседнем `json/`. Каждая из 36 коллекций имеет оболочку `{ "schemaVersion": "1.0.0", "items": [...] }`; сущности содержат уникальные внутри коллекции `id`, `name`, `tags` и специальные поля. Лишние поля запрещены. Поля с `x-collection` проверяются как ссылки.

`CONTENT_PATHS` задаёт имена JSON внутри ZIP. Например, `combat/weapons.json`, `entities/characters.json`, `world/levels.json`, `world/level-sequences.json`, `effects/effect-definitions.json`. Редактор хранит весь Content объект в draft, ZIP — отдельные коллекции и медиа.

Manifest содержит `schemaVersion`, `engineVersion`, `contentVersion`, `requiredExtensions` с точными версиями, `files` с path/SHA-256/bytes. Изменение файла требует новой публикации. Путь ZIP относительный, без `..`, обратных слешей, абсолютных дисков и symlinks. Ограничения импорта: архив 64 MiB, до 4096 entries, файл 16 MiB, суммарно 128 MiB после распаковки, коэффициент сжатия до 300. MIME определяется по содержимому; картинки декодируются, проверяются размеры и границы sprite frames.

Gameplay задержки измеряются в целых ticks при 30 Hz. Анимации и presentation используют миллисекунды. Sprite frame и pivot заданы в исходных пикселях, position — в мировых пикселях, tile cells — индексами клеток. `renderScale` не меняет collision.

Пять классов оружия: bullet/shotgun/bolt с projectileId, laser с beamId, melee с геометрией объёма. Effect mode: builtin, graph, custom_extension. Extension params сверяются со схемой из доверенной сборки. Произвольный код в JSON не принимается.

`npm run content:validate` проверяет базовый набор и полный ZIP roundtrip. После изменения definitions выполните `npm run generate`, обновите JSON Schema, тесты и новый contentVersion. Автоматических конвертеров старых форматов пока нет: несовместимые версии отвергаются.
