import type { ContentRegistry } from "../../content-loader/src/registry";
import type { Vec2 } from "../../shared-types/src/index";
import { Rng } from "../../game-core/src/math";
export type Particle = {
  active: boolean;
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  age: number;
  life: number;
  size: number;
  alpha: number;
  color: string;
  spriteId: string;
  effectId: string;
};
type Emitter = {
  id: string;
  effectId: string;
  position: Vec2;
  age: number;
  accumulator: number;
  rng: Rng;
};
export class ParticleSystem {
  readonly pool: Particle[] = [];
  private emitters: Emitter[] = [];
  private sequence = 0;
  quality: "low" | "medium" | "high" = "high";
  dropped = 0;
  constructor(private registry: ContentRegistry) {}
  play(effectId: string, position: Vec2, seed: number) {
    const e = {
      id: `emitter-${++this.sequence}`,
      effectId,
      position: { ...position },
      age: 0,
      accumulator: 0,
      rng: new Rng(seed),
    };
    const def = this.registry.get("particles", effectId);
    if (def.emission.mode === "burst")
      for (let i = 0; i < def.emission.count; i++) this.spawn(e);
    else if (this.emitters.length < 64) this.emitters.push(e);
    return e.id;
  }
  private spawn(e: Emitter) {
    const def = this.registry.get("particles", e.effectId);
    const cap =
      this.quality === "high" ? 1000 : this.quality === "medium" ? 400 : 120;
    if (
      this.pool.filter((p) => p.active && p.effectId === def.id).length >=
      def.emission.maxAlive
    ) {
      this.dropped++;
      return;
    }
    let p = this.pool.find((p) => !p.active);
    if (!p && this.pool.length < cap) {
      p = {} as Particle;
      this.pool.push(p);
    }
    if (!p) {
      this.dropped++;
      return;
    }
    const random = (min: number, max: number) =>
        min + e.rng.next() * (max - min),
      angle =
        ((def.emission.directionDeg +
          (e.rng.next() - 0.5) * def.emission.spreadDeg) *
          Math.PI) /
        180,
      speed = random(def.motion.speed.min, def.motion.speed.max),
      rad = def.emission.shapeRadius;
    let x = e.position.x,
      y = e.position.y;
    if (def.emission.shape === "circle") {
      const a = random(0, Math.PI * 2),
        r = Math.sqrt(e.rng.next()) * rad;
      x += Math.cos(a) * r;
      y += Math.sin(a) * r;
    }
    if (["line", "rectangle"].includes(def.emission.shape))
      x += random(-rad, rad);
    if (def.emission.shape === "rectangle") y += random(-rad, rad);
    Object.assign(p, {
      active: true,
      id: `p-${++this.sequence}`,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: random(def.motion.rotationDeg.min, def.motion.rotationDeg.max),
      spin: random(
        def.motion.angularVelocityDegPerSecond.min,
        def.motion.angularVelocityDegPerSecond.max,
      ),
      age: 0,
      life: random(def.lifetimeMs.min, def.lifetimeMs.max) / 1000,
      size: 1,
      alpha: 1,
      color: def.color,
      spriteId: def.spriteId,
      effectId: def.id,
    });
  }
  step(delta: number) {
    const dt = Math.min(0.05, Math.max(0, delta));
    for (const e of this.emitters) {
      const def = this.registry.get("particles", e.effectId);
      e.age += dt;
      e.accumulator += dt * def.emission.ratePerSecond;
      let count = Math.min(100, Math.floor(e.accumulator));
      e.accumulator -= count;
      while (count-- > 0) this.spawn(e);
    }
    this.emitters = this.emitters.filter((e) => {
      const d = this.registry.get("particles", e.effectId);
      return (
        d.emission.durationMs === 0 || e.age * 1000 < d.emission.durationMs
      );
    });
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      const def = this.registry.get("particles", p.effectId),
        motion = def.motion;
      p.vx =
        (p.vx + (motion.acceleration.x + motion.gravity.x) * dt) *
        Math.exp(-motion.dragPerSecond * dt);
      p.vy =
        (p.vy + (motion.acceleration.y + motion.gravity.y) * dt) *
        Math.exp(-motion.dragPerSecond * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation = motion.alignToVelocity
        ? (Math.atan2(p.vy, p.vx) * 180) / Math.PI
        : p.rotation + p.spin * dt;
      p.size = curve(def.sizeOverLife, p.age / p.life);
      p.alpha = curve(def.alphaOverLife, p.age / p.life);
    }
  }
  stop(id: string) {
    this.emitters = this.emitters.filter((e) => e.id !== id);
  }
  dispose() {
    this.emitters = [];
    this.pool.length = 0;
  }
}
export function curve(points: { t: number; value: number }[], t: number) {
  for (let i = 1; i < points.length; i++)
    if (t <= points[i].t) {
      const a = points[i - 1],
        b = points[i];
      return a.value + ((b.value - a.value) * (t - a.t)) / (b.t - a.t);
    }
  return points.at(-1)?.value ?? 0;
}
