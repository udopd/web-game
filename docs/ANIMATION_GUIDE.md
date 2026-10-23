# Спрайты и анимации

Sprite ссылается на source в assets/, прямоугольник frame, pivot в пикселях исходного кадра, renderScale, rotationOffsetDeg и layer. Изображение остаётся исходным атласом: runtime добавляет именованные frames без изменения байтов PNG. Коллайдер задаётся отдельно в определении сущности.

Animation содержит упорядоченный frames с spriteId/durationMs/offset/events, loop, holdLastFrame и direction. Preview позволяет проигрывать, останавливать и перемещаться по времени, менять длительности. Playback использует сумму длительностей; незацикленный clip останавливается на последнем кадре. Обязательные состояния игрока: idle, run, hurt, death, victory.

GameView использует animationSet сущности и stateTick из серверного snapshot. Frame events передаются общему presentation router и не меняют gameplay. Binding play_animation временно переопределяет визуальный clip. Параметры звука, частиц и camera effect находятся в собственных определениях.

Базовый набор включает scout 4×4 и атлас врагов 8×4: три врага и босс, по две idle/run, hurt, windup и две death frames. Точные метаданные генерирует `scripts/animate-content.ts`. Art QA ещё требует очистки прозрачных краёв, проверки пиксельной сетки и читаемости при игровом масштабе; AI-атлас не следует считать готовым нативным pixel sheet только на основании его разрешения.

Массовое выделение кадров, onion skin, полноценное редактирование hitbox/pivot на холсте и отдельные направления всех анимаций пока не реализованы.
