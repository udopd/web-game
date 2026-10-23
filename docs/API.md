# HTTP и WebSocket API

Origin должен совпадать с APP_ORIGIN. Для изменяющих запросов авторизованных клиентов обязателен `X-CSRF-Token`, полученный при login/register или GET session/profile. Cookies HttpOnly/SameSite=Strict, Secure и префикс __Host включаются при HTTPS. JSON body отправляется только когда endpoint принимает данные; пустой POST не должен иметь Content-Type application/json.

| Метод / путь | Доступ | Данные / результат |
|---|---|---|
| GET /health | public | Реальная доступность PostgreSQL/S3 |
| POST /api/register | Origin, rate limit | `{name}` → UID, CSRF, player cookie |
| GET /api/users/me | player | Профиль, настройки, unlocks, текущая комната |
| PATCH /api/users/me/settings | player + CSRF | Частичный объект настроек |
| GET /api/users/me/runs | player | История участия |
| POST /api/users/me/progress/reset | player + CSRF | `{confirmation:"RESET PROGRESS",requestId:UUID}`; запрещён при активной комнате |
| GET /api/leaderboard?sort=depth | public | Рейтинг; также sort=kills |
| GET /api/content/current | public | Активная version |
| GET /api/content/:version/manifest | public | Manifest опубликованной версии |
| GET /api/content/:version/files/* | public | Только перечисленные в manifest файлы |
| POST /api/rooms | player + CSRF | `{campaignId}` → комната |
| GET /api/rooms/:id | member | Состояние комнаты |
| POST /api/rooms/:id/join | player + CSRF | Вход в свободное lobby |
| POST /api/rooms/:id/ready | member + CSRF | `{ready,characterId}` |
| POST /api/rooms/:id/start | owner + CSRF | Новый серверный run |
| POST /api/rooms/:id/transfer | owner + CSRF | `{uid}` |
| POST /api/rooms/:id/kick | lobby owner + CSRF | `{uid}` |
| POST /api/rooms/:id/leave | member + CSRF | Явный выход |
| WS /ws/rooms/:id | member + Origin | input → room/snapshot/events/error |
| POST /api/editor/auth/login | Origin, rate limit | `{token}` → CSRF + editor cookie |
| GET /api/editor/session | editor | CSRF и роль |
| POST /api/editor/auth/logout | editor + CSRF | Отзыв сессии |
| GET/POST /api/editor/projects | editor / + CSRF | Список / создание проекта |
| GET/PUT /api/editor/projects/:id | editor / + CSRF | Draft / сохранение content, ui, revision |
| POST /api/editor/validate | editor + CSRF | `{content}` → ошибки черновика |
| POST /api/editor/projects/:id/export | editor + CSRF | ZIP |
| POST /api/editor/projects/:id/import | editor + CSRF | Multipart ZIP |
| POST /api/editor/projects/:id/publish | editor + CSRF | `{version,revision}` |
| GET /api/editor/versions | editor | Опубликованные версии |
| POST /api/editor/rollback | editor + CSRF | `{version}` |
| GET/POST /api/editor/assets | editor / + CSRF | Список / multipart file |
| GET /api/editor/asset?key=… | editor | Проверенные байты закрытого ресурса |
| GET /api/editor/extensions | editor | Trusted extension catalog |
| POST /api/editor/preview | editor + CSRF | `{content,campaignId,characterId,seed,ticks}`; ticks ≤ 300 |

Ошибки возвращают `{error,requestId}`. Основные статусы: 400 — структура, 401 — сессия, 403 — полномочия/Origin/CSRF, 409 — revision/состояние/immutable conflict, 422 — контент, 429 — rate limit. Серверные подробности ошибки 500 не возвращаются клиенту. Полный machine-readable OpenAPI и все специализированные маршруты исходного ТЗ пока не предоставлены; текущие маршруты определены в `apps/server/src/app.ts` и `auth.ts`.
