import { describe, it, expect } from "vitest";
import { content } from "../fixtures";
import { validateContent } from "../../packages/content-schemas/src/validate";
import {
  buildPack,
  readPack,
  safePackPath,
} from "../../packages/content-loader/src/packs";
import { readFile } from "node:fs/promises";
import { inspectAsset } from "../../packages/asset-pipeline/src/index";
import { animationFrame } from "../../packages/presentation/src/animation";
import {
  ParticleSystem,
  curve,
} from "../../packages/presentation/src/particles";
import { registry } from "../fixtures";
describe("Content boundary", () => {
  it("validates all shipped definitions", () =>
    expect(validateContent(content)).toEqual([]));
  it("reports missing references with a path", () => {
    const c = structuredClone(content);
    c.weapons.items[0].spriteId = "missing";
    expect(
      validateContent(c).some(
        (e) => e.path.includes("spriteId") && e.message.includes("Missing"),
      ),
    ).toBe(true);
  });
  it("rejects unknown fields and duplicate IDs", () => {
    const c = structuredClone(content);
    (c.weapons.items[0] as any).javascript = "alert(1)";
    expect(validateContent(c).length).toBeGreaterThan(0);
    delete (c.weapons.items[0] as any).javascript;
    c.weapons.items.push(c.weapons.items[0]);
    expect(
      validateContent(c).some((e) => e.message.includes("Duplicate")),
    ).toBe(true);
  });
  it("requires every player animation state", () => {
    const c = structuredClone(content);
    delete c.characters.items[0].animationSet.death;
    expect(
      validateContent(c).some((e) =>
        e.message.includes("Required player animation"),
      ),
    ).toBe(true);
  });
  it("rejects recursive effect graphs", () => {
    const c = structuredClone(content),
      g = c.graphs.items[0];
    g.edges.push({ from: g.nodes.at(-1)!.id, to: g.nodes[0].id });
    expect(validateContent(c).some((e) => /cycl/i.test(e.message))).toBe(true);
  });
  it.each([
    "../secret",
    "/absolute",
    "assets/../../x",
    "C:/file",
    "assets\\x",
    "assets//x",
    "./x",
  ])("rejects unsafe path %s", (p) => expect(safePackPath(p)).toBe(false));
  it("exports/imports all collections and verifies every asset hash", async () => {
    const pack = await buildPack(content, "test-roundtrip", (path) =>
      readFile(`content/base-game/${path}`),
    );
    const restored = await readPack(pack.archive);
    expect(restored.content).toEqual(content);
    expect(restored.manifest.files).toHaveLength(41);
    const corrupted = Buffer.from(pack.archive);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    await expect(readPack(corrupted)).rejects.toThrow();
  });
  it("rejects a spoofed HTML image", async () => {
    await expect(
      inspectAsset(Buffer.from('<svg onload="alert(1)"></svg>')),
    ).rejects.toThrow("Unsupported");
  });
  it("sniffs a real PNG, bounds and decodes it", async () => {
    const result = await inspectAsset(
      await readFile("content/base-game/assets/sprites/scout.png"),
    );
    expect(result.mime).toBe("image/png");
    expect(result.width).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects frames outside the actual source image", async () => {
    const c = structuredClone(content);
    c.sprites.items[0].frame.x = 4000;
    await expect(
      buildPack(c, "invalid", (p) => readFile(`content/base-game/${p}`)),
    ).rejects.toThrow("Frame outside");
  });
});
describe("Pure presentation timeline", () => {
  it("uses each frame duration and holds terminal clips", () => {
    const clip = structuredClone(
      content.animations.items.find((a) => a.frames.length >= 3)!,
    );
    clip.loop = false;
    clip.frames[0].durationMs = 50;
    clip.frames[1].durationMs = 120;
    expect(animationFrame(clip, 49).index).toBe(0);
    expect(animationFrame(clip, 50).index).toBe(1);
    expect(animationFrame(clip, 170).index).toBe(2);
    expect(animationFrame(clip, 100000).complete).toBe(true);
    expect(animationFrame(clip, 100000).index).toBe(clip.frames.length - 1);
  });
  it("interpolates particle curves", () =>
    expect(
      curve(
        [
          { t: 0, value: 1 },
          { t: 1, value: 0 },
        ],
        0.25,
      ),
    ).toBe(0.75));
  it("caps particles and expires them", () => {
    const particles = new ParticleSystem(registry);
    particles.quality = "low";
    for (let i = 0; i < 100; i++)
      particles.play(content.particles.items[0].id, { x: 0, y: 0 }, i);
    expect(particles.pool.length).toBeLessThanOrEqual(120);
    expect(particles.dropped).toBeGreaterThan(0);
    for (let i = 0; i < 1000; i++) particles.step(0.05);
    expect(particles.pool.filter((p) => p.active)).toHaveLength(0);
  });
});
