# Custom Mutation SDK

JSON-эффекты могут быть builtin, graph или custom_extension. TypeScript extensions входят в доверенную серверную сборку: SDK не является sandbox для кода из интернета. JSON-импорт не устанавливает исполняемые файлы.

```sh
npm run mutation:create -- my-mutation
npm run mutation:generate-registry
npm run typecheck
npm test
```

CLI создаёт каталог `packages/mutation-extensions/src/my-mutation` с extension.json, params.schema.json, editor.schema.json, handler.ts и README. Имя должно соответствовать `[a-z][a-z0-9-]{2,50}`; существующий каталог не перезаписывается. Начальный обработчик наносит урон ближайшему врагу после убийства владельцем. Измените его под нужную механику и добавьте replay/edge-case tests.

Контракт `MutationExtension<P,S>` содержит id, version, subscribedEvents, initialState и onEvent. Context предоставляет owner/getEntity/entitiesInRadius/isEnemyOf, детерминированный random01, emitDamage и emitVfx. EntityView readonly; изменения мира идут через очередь команд. State должен сериализоваться вместе со snapshot. Не используйте Date.now, Math.random, DOM, файлы, сеть или прямое изменение Simulation.

`ext.chain_lightning` демонстрирует поиск от позиции погибшей цели, стабильную сортировку ближайших живых врагов, уникальные прыжки, cooldown в ticks и запрет повторного запуска от собственного mutation damage. Regression test находится в `tests/simulation/effects.test.ts`.

После регистрации создайте effect с `mode: custom_extension`, соответствующими extensionId/extensionVersion, подписанным event и params. Добавьте effect ID в mutation. Параметры проверяет готовый валидатор, а requiredExtensions попадает в manifest. Изменение обработчика требует новой версии расширения, сборки сервера и content pack; старая семантика не должна заменяться под тем же номером.

Текущий SDK поддерживает только указанную поверхность команд. Полный lifecycle onAcquire/onRemove/onTick, миграции custom state и расширенные интерфейсы из исходной спецификации ещё открыты. Генератор registry также требует проверки совместимости разнотипных расширений перед расширением набора.
