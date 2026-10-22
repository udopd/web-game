import type { ContentRegistry } from "../../content-loader/src/registry";
import type {
  GameEvent,
  UserSettings,
  Vec2,
} from "../../shared-types/src/index";
import { conditionMatches } from "../../effect-engine/src/index";
import { AudioSystem, MusicDirector } from "./audio";
import { ParticleSystem } from "./particles";
export class CameraEffectSystem {
  private effects: { id: string; age: number }[] = [];
  strength = 0.5;
  reduced = false;
  constructor(private registry: ContentRegistry) {}
  play(id: string) {
    const def = this.registry.get("cameraEffects", id);
    if (def.stacking === "replace") this.effects = [];
    if (this.effects.length < 16) this.effects.push({ id, age: 0 });
  }
  step(dt: number): Vec2 {
    let amplitude = 0,
      x = 0,
      y = 0;
    for (const e of this.effects) {
      e.age += dt * 1000;
      const d = this.registry.get("cameraEffects", e.id),
        fall = Math.max(0, 1 - e.age / d.durationMs),
        a = d.amplitudePx * (d.falloff === "easeOut" ? fall * fall : fall);
      if (d.stacking === "add_capped") amplitude += a;
      else amplitude = Math.max(amplitude, a);
      x += Math.sin(((e.age * d.frequencyHz) / 1000) * Math.PI * 2);
      y += Math.cos(((e.age * d.frequencyHz) / 1000) * Math.PI * 2 * 1.3);
    }
    this.effects = this.effects.filter(
      (e) => e.age < this.registry.get("cameraEffects", e.id).durationMs,
    );
    const scale = this.reduced ? 0 : Math.min(amplitude, 8) * this.strength;
    return { x: Math.sin(x) * scale, y: Math.sin(y) * scale };
  }
}
export class PresentationRouter {
  readonly audio: AudioSystem;
  readonly music: MusicDirector;
  readonly particles: ParticleSystem;
  readonly camera: CameraEffectSystem;
  private seen = new Set<string>();
  private last = new Map<string, number>();
  constructor(
    private registry: ContentRegistry,
    assetUrl: (path: string) => string,
    private localId: string,
  ) {
    this.audio = new AudioSystem(registry, assetUrl);
    this.music = new MusicDirector(this.audio);
    this.particles = new ParticleSystem(registry);
    this.camera = new CameraEffectSystem(registry);
  }
  settings(s: UserSettings) {
    this.audio.settings(s);
    this.particles.quality = s.particleQuality;
    this.camera.strength = s.screenShakeStrength / 100;
    this.camera.reduced =
      s.reducedMotion === "on" ||
      (s.reducedMotion === "auto" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  dispatch(event: GameEvent, listener: Vec2) {
    if (this.seen.has(event.eventId)) return;
    this.seen.add(event.eventId);
    if (this.seen.size > 2048)
      this.seen.delete(this.seen.values().next().value!);
    for (const binding of this.registry.all("eventBindings")) {
      if (
        !binding.enabled ||
        binding.event !== event.type ||
        !binding.conditions.every((c) => conditionMatches(c, event))
      )
        continue;
      const now = (event.tick * 1000) / 30;
      if (now - (this.last.get(binding.id) ?? -Infinity) < binding.cooldownMs)
        continue;
      const random =
        ((event.tick * 1664525 + event.eventId.length * 1013904223) >>> 0) /
        4294967296;
      if (random > binding.probability) continue;
      this.last.set(binding.id, now);
      for (const action of binding.actions) {
        if (action.type === "play_sfx")
          void this.audio
            .play(action.soundId, event.position, listener)
            .catch(() => {});
        if (action.type === "spawn_particles")
          this.particles.play(
            action.particleEffectId,
            event.position,
            event.tick + this.seen.size,
          );
        if (
          action.type === "camera_effect" &&
          (action.scope !== "local_actor" || event.actorId === this.localId)
        )
          this.camera.play(action.cameraEffectId);
        if (action.type === "switch_music")
          void this.music.transition(action.musicId).catch(() => {});
      }
    }
  }
  dispose() {
    this.music.stop();
    this.audio.dispose();
    this.particles.dispose();
  }
}
