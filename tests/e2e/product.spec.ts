import { test, expect } from "@playwright/test";
import "dotenv/config";
import { mkdir } from "node:fs/promises";
test("public game: registration, room, authoritative play, settings persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Там, где руины/ }),
  ).toBeVisible();
  await mkdir("docs/qa", { recursive: true });
  await page.screenshot({ path: "docs/qa/home.png", fullPage: true });
  await page.getByLabel("Имя исследователя").fill("QA Scout");
  await page.getByRole("button", { name: "Создать профиль" }).click();
  await expect(
    page.getByRole("button", { name: "Начать экспедицию" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Начать экспедицию" }).click();
  await expect(
    page.getByRole("heading", { name: /Сбор команды/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Я готов", exact: true }).click();
  await page.getByRole("button", { name: "Отправиться", exact: true }).click();
  await expect(page.locator(".game-canvas canvas")).toBeVisible();
  await expect(page.locator(".control-help")).toContainText("тик");
  await page
    .locator(".game-canvas canvas")
    .click({ position: { x: 300, y: 200 } });
  await page.keyboard.down("d");
  await page.waitForTimeout(700);
  await page.keyboard.up("d");
  await page.screenshot({ path: "docs/qa/game.png", fullPage: true });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole('combobox',{name:'Частицы',exact:true}).selectOption('low');
  await page.getByLabel("Закрыть настройки").click();
  await page.reload();
  await expect(page.locator(".game-canvas canvas")).toBeVisible();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Частицы',exact:true})).toHaveValue('low');
  await page.getByLabel('Закрыть настройки').click();
  await page.getByRole("button", { name: "Покинуть", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Там, где руины/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("editor: protected shell, real login, edit/save/undo, graph, map, export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/editor");
  await expect(
    page.getByRole("heading", { name: "Вход в редактор" }),
  ).toBeVisible();
  await page
    .getByLabel("Токен администратора")
    .fill(process.env.ADMIN_EDITOR_TOKEN!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByLabel("Проект", { exact: true })).toBeVisible();
  await expect(page.getByText("Ошибка панели:", { exact: false })).toHaveCount(
    0,
  );
  await page
    .getByLabel("weapons.revolver.name", { exact: true })
    .waitFor()
    .catch(() => {});
  const input = page.locator('.inspector input[aria-label$=".name"]').first();
  await expect(input).toBeVisible();
  const original = await input.inputValue();
  await input.fill(`${original} QA`);
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  await page.reload();
  await expect(
    page.locator('.inspector input[aria-label$=".name"]').first(),
  ).toHaveValue(`${original} QA`);
  await page
    .locator('.inspector input[aria-label$=".name"]')
    .first()
    .fill(original);
  await expect(page.locator(".save-status")).toContainText("Сохранено");
  await page.screenshot({ path: "docs/qa/editor.png", fullPage: true });
  await page.getByLabel("Макет редактора").selectOption("logic");
  await expect(
    page.getByText("Выберите граф эффекта или кампанию", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Event Logic/ })
    .first()
    .click();
  await page.locator(".library-item").filter({ hasText: "graphs" }).count();
  await page.getByLabel("Макет редактора").selectOption("level");
  await expect(
    page.getByText("Выберите tilemap", { exact: false }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  expect(errors).toEqual([]);
});
test("mobile menu fits viewport and characters remain reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Там, где руины/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Персонажи", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Кто отправится в глубины?" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: "docs/qa/mobile.png", fullPage: true });
});
