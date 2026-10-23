# Уровни и кампании

Выберите tilemap в библиотеке и пресет Level. Холст поддерживает выбор слоя, brush, eraser, flood fill, rectangle, grid/collision overlay и zoom. Один stroke создаёт одну операцию undo. Объекты enemy/boss/prop/chest, player_spawn и level_exit размещаются отдельно от клеток. Значения и ссылки доступны в инспекторе.

Palette описывает размер тайла, spriteId, walkable и projectileBlocking. Tilemap хранит до четырёх слоёв и placement coordinates. Валидатор проверяет размеры, известные tile IDs, ссылки объектов, обязательные spawn/exit, препятствия и достижимость выхода. Runtime пока сводит слои к видимому верхнему тайлу с объединённой collision mask.

Level выбирает biome, режим handcrafted/procedural/hybrid, ссылки на map/generation rule, таблицы врагов/декораций/сундуков и difficultyBudget. Генерация использует seed, комнаты/коридоры, required templates для hybrid, ограниченное число попыток, clearance и обязательный маршрут. Batch regression охватывает 40 seeds для каждого из пяти уровней. UI пакетных прогонов/heatmaps пока отсутствует.

Campaign graph связывает level/boss/milestone/end nodes. Рёбра поддерживают always, weighted_random, player_choice и condition; валидатор отвергает циклы и недостижимые узлы. Endless повторяет кампанию с ограничением maxRepeats. В игре после зачистки нужно дойти до выхода и нажать E; player_choice выбирается кнопкой ветки.

Открытые области: spawnZones, autotile/variants, некоторые параметры depth/template и difficultyScale ещё не участвуют в runtime; полноценные слои rendering/opacity/locking, список кампании, редактирование зон и branch simulation UI требуют реализации. Эти поля нельзя считать рабочими только потому, что они присутствуют в схеме и инспекторе.
