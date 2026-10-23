import type { ContentRegistry } from "../../content-loader/src/registry";
import type { UserSettings, Vec2 } from "../../shared-types/src/index";
export class AudioSystem {
  readonly context = new AudioContext();
  readonly sfx = this.context.createGain();
  readonly music = this.context.createGain();
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string,Promise<AudioBuffer>>();
  private voices: {
    id: string;
    source: AudioBufferSourceNode;
    priority: number;
  }[] = [];
  private last = new Map<string, number>();
  private disposed = false;
  constructor(
    readonly registry: ContentRegistry,
    readonly assetUrl: (path: string) => string,
  ) {
    this.sfx.connect(this.context.destination);
    this.music.connect(this.context.destination);
  }
  async unlock() {
    if (!this.disposed && this.context.state === "suspended")
      await this.context.resume();
  }
  async buffer(path: string) {
    const b = this.buffers.get(path);
    if (b) return b;
    let pending=this.loading.get(path);if(!pending){pending=(async()=>{const response=await fetch(this.assetUrl(path));if(!response.ok)throw new Error('Audio resource unavailable');const buffer=await this.context.decodeAudioData(await response.arrayBuffer());if(!this.disposed)this.buffers.set(path,buffer);return buffer;})();this.loading.set(path,pending);pending.finally(()=>this.loading.delete(path)).catch(()=>{});}return pending;
  }
  settings(settings: UserSettings) {
    this.sfx.gain.value = settings.muteSfx
      ? 0
      : (settings.sfxVolume / 100) ** 2;
    this.music.gain.value = settings.muteMusic
      ? 0
      : (settings.musicVolume / 100) ** 2;
  }
  async play(id: string, position: Vec2, listener: Vec2 = { x: 0, y: 0 }) {
    if (this.disposed || this.context.state !== "running") return;
    const def = this.registry.get("sounds", id),
      now = this.context.currentTime;
    if (now - (this.last.get(id) ?? -Infinity) < def.cooldownMs / 1000) return;
    this.last.set(id, now);
    const buffer = await this.buffer(def.source);
    if (this.disposed) return;
    const same = this.voices.filter((v) => v.id === id);
    if (same.length >= def.maxConcurrent) same[0].source.stop();
    if (this.voices.length >= 64)
      this.voices
        .reduce((a, b) => (a.priority < b.priority ? a : b))
        .source.stop();
    const source = this.context.createBufferSource(),
      gain = this.context.createGain(),
      pan = this.context.createStereoPanner();
    source.buffer = buffer;
    source.loop = def.loop;
    source.playbackRate.value = (def.pitch.min + def.pitch.max) / 2;
    const distance = Math.hypot(
      position.x - listener.x,
      position.y - listener.y,
    );
    gain.gain.value =
      def.baseGain *
      (def.spatial.enabled
        ? Math.max(0, 1 - distance / def.spatial.maxDistance)
        : 1);
    pan.pan.value = def.spatial.enabled
      ? Math.max(-1, Math.min(1, (position.x - listener.x) / 300))
      : 0;
    source.connect(gain).connect(pan).connect(this.sfx);
    const voice = { id, source, priority: def.priority };
    this.voices.push(voice);
    source.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
    source.start();
  }
  dispose() {
    this.disposed = true;
    for (const voice of this.voices) voice.source.stop();
    this.voices = [];
    this.buffers.clear();
    void this.context.close();
  }
}
export class MusicDirector {
  private requested?:string;
  private current?: {
    id: string;
    source: AudioBufferSourceNode;
    gain: GainNode;
  };
  private generation = 0;
  constructor(private audio: AudioSystem) {}
  async transition(id: string) {
    if (this.current?.id === id||this.requested===id) return;
    this.requested=id;
    const generation = ++this.generation,
      def = this.audio.registry.get("music", id);
    let buffer:AudioBuffer;try{buffer=await this.audio.buffer(def.source);}catch(e){if(generation===this.generation)this.requested=undefined;throw e;}
    if (generation !== this.generation) return;
    const ctx = this.audio.context;
    if (ctx.state === "closed") return;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = def.loop;
    source.loopStart = def.loopStartMs / 1000;
    source.loopEnd = def.loopEndMs / 1000;
    source.connect(gain).connect(this.audio.music);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(
      def.baseGain,
      ctx.currentTime + def.fadeInMs / 1000,
    );
    if (this.current) {
      const old = this.current;
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(
        0,
        ctx.currentTime + def.fadeOutMs / 1000,
      );
      old.source.stop(ctx.currentTime + def.fadeOutMs / 1000);
      old.source.onended = () => {
        old.source.disconnect();
        old.gain.disconnect();
      };
    }
    source.start();
    this.current = { id, source, gain };
  }
  stop() {
    this.generation++;
    this.requested=undefined;
    this.current?.source.stop();
    this.current = undefined;
  }
}
