import type { ContentRegistry } from "../../content-loader/src/registry";
import type {
  GameEvent,
  UserSettings,
  Vec2,
} from "../../shared-types/src/index";
import { conditionMatches } from "../../effect-engine/src/index";
import { AudioSystem, MusicDirector } from "./audio";
import { ParticleSystem } from "./particles";
import type {Definition} from '../../content-schemas/src/definitions';
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
  readonly animationOverrides=new Map<string,{id:string;tick:number;expires:number}>();
  onError?:(message:string)=>void;
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
      let hash=2166136261;for(const c of `${event.eventId}:${binding.id}`)hash=Math.imul(hash^c.charCodeAt(0),16777619);const random=(hash>>>0)/4294967296;
      if (random > binding.probability) continue;
      this.last.set(binding.id, now);
      for (const action of binding.actions)this.play(action,event,listener);
    }
  }
  play(action:Definition<'eventBindings'>['actions'][number],event:Pick<GameEvent,'actorId'|'position'|'tick'>,listener:Vec2){
    if(action.type==='play_sfx')void this.audio.play(action.soundId,event.position,listener).catch(e=>this.onError?.(e.message));
    if(action.type==='spawn_particles')this.particles.play(action.particleEffectId,event.position,event.tick+this.seen.size);
    if(action.type==='camera_effect'){const range=this.registry.get('cameraEffects',action.cameraEffectId).maxDistance;if(action.scope==='local_actor'&&event.actorId!==this.localId)return;if(action.scope==='nearby_players'&&Math.hypot(event.position.x-listener.x,event.position.y-listener.y)>range)return;this.camera.play(action.cameraEffectId);}
    if(action.type==='switch_music')void this.music.transition(action.musicId).catch(e=>this.onError?.(e.message));
    if(action.type==='play_animation'){const clip=this.registry.get('animations',action.animationId);this.animationOverrides.set(event.actorId,{id:clip.id,tick:event.tick,expires:event.tick+Math.ceil(clip.frames.reduce((n,f)=>n+f.durationMs,0)*30/1000)});if(this.animationOverrides.size>512)this.animationOverrides.delete(this.animationOverrides.keys().next().value!);}
  }
  dispose() {
    this.music.stop();
    this.audio.dispose();
    this.particles.dispose();
    this.animationOverrides.clear();
  }
}
