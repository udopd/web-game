# Emberfall

Браузерный roguelike shooter и защищённый редактор контента. Исходники находятся в `apps/`, общая симуляция и контракты — в `packages/`, стартовый контент — в `content/base-game/`.

**Разработка продолжается. Полный Definition of Done исходного ТЗ ещё не выполнен.** Проверенные возможности и оставшиеся работы перечислены в [статусе реализации](docs/IMPLEMENTATION_STATUS.md). Это действующие клиент, сервер, PostgreSQL и S3, а не статические макеты.

## Локальный запуск

Нужны Node.js 24+, npm и Docker с Linux containers.

```sh
npm ci
node scripts/setup-env.mjs
docker compose up -d --wait postgres storage
npm run build
npm run db:migrate
npm run db:seed
npm start
```

Игра: <http://localhost:3100>. Редактор: <http://localhost:3100/editor>. Токен входа находится в созданном `.env`, в переменной `ADMIN_EDITOR_TOKEN`. Скрипт создания окружения не перезаписывает существующий файл. Не передавайте токен в URL, клиентский build или репозиторий.

Вариант, когда и приложение работает в контейнере:

```sh
node scripts/setup-env.mjs
docker compose --profile full up -d --build --wait
```

Не запускайте контейнер приложения и локальный сервер одновременно на порту 3100. База и хранилище используют отдельные Docker volumes; обычный `docker compose stop` сохраняет данные. Production требует HTTPS; см. [развёртывание](docs/DEPLOYMENT.md).

## Работа

Создайте профиль, нажмите «Начать экспедицию», выберите персонажа и отметьте готовность. Другие игроки вводят код комнаты. Лидер запускает забег. Управление: WASD, мышь, ЛКМ — выстрел, 1–5 — оружие, E — сундук/выход. UID привязан к HttpOnly-сессии браузера; восстановление доступа по одному публичному UID не предусмотрено.

Редактор сохраняет черновики отдельно от опубликованной версии. Изменения попадают в новые забеги после проверки и публикации новой версии. Уже запущенные комнаты сохраняют свой контент. Общий preview использует тот же класс Simulation, что сервер.

## Проверки и документация

```sh
npm run typecheck
npm run content:validate
npm test
npm run test:e2e
```

Для `npm test` нужны запущенные PostgreSQL/S3, миграции и seed. Для E2E дополнительно нужен сервер и Chrome; `PLAYWRIGHT_CHANNEL=chromium` позволяет использовать установленный Playwright Chromium. [TESTING](docs/TESTING.md) описывает реальное покрытие и ограничения.

- [Архитектура](docs/ARCHITECTURE.md), [API](docs/API.md), [мультиплеер](docs/MULTIPLAYER.md)
- [Редактор](docs/EDITOR_GUIDE.md), [формат контента](docs/CONTENT_FORMAT.md)
- [Мутации](docs/CUSTOM_MUTATION_GUIDE.md), [анимации](docs/ANIMATION_GUIDE.md), [уровни](docs/LEVEL_EDITOR_GUIDE.md)
- [Происхождение ресурсов](docs/ASSET_PROVENANCE.md), [план](docs/IMPLEMENTATION_PLAN.md), [матрица требований](docs/REQUIREMENTS_MATRIX.md)

Зависимости зафиксированы в `package-lock.json`. Все команды установки выполняются из корня. Подсистемы пока импортируют TypeScript по относительным путям; независимая публикация npm-пакетов не настроена.
