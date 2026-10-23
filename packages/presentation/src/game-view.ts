import Phaser from "phaser";
import type { ContentRegistry } from "../../content-loader/src/registry";
import type { WorldState } from "../../simulation/src/types";
import {
  DEFAULT_SETTINGS,
  type InputCommand,
  type UserSettings,
} from "../../shared-types/src/index";
import { PresentationRouter } from "./router";
import { animationFrame } from "./animation";

export type GameViewOptions = {
  parent: HTMLElement;
  registry: ContentRegistry;
  assetUrl: (path: string) => string;
  localId: string;
  settings?: UserSettings;
  input?: (input: InputCommand) => void;
  error?: (message: string) => void;
};
/** A presentation-only Phaser scene. Both the live client and editor feed the same snapshots. */
export class GameView {
  private frameKeys=new Map<string,string>();
  private keys = new Set<string>();
  private keyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };
  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => {
    this.keys.clear();
    this.release();
  };
  readonly game: Phaser.Game;
  readonly router: PresentationRouter;
  state?: WorldState;
  settings: UserSettings;
  debug = false;
  private scene?: Phaser.Scene;
  private images = new Map<string, Phaser.GameObjects.Image>();
  private tiles: Phaser.GameObjects.Image[] = [];
  private mapKey = "";
  private graphics?: Phaser.GameObjects.Graphics;
  private seq = 0;
  private accumulator = 0;
  private receivedAt = 0;
  private pendingMutation?: string;
  private pendingExit?: string;
  private destroyed = false;
  private slot = 0;
  constructor(readonly options: GameViewOptions) {
    this.settings = options.settings ?? DEFAULT_SETTINGS;
    this.router = new PresentationRouter(
      options.registry,
      options.assetUrl,
      options.localId,
    );
    this.router.settings(this.settings);
    this.router.onError=options.error;
    const view = this;
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blur);
    this.game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: options.parent,
      backgroundColor: "#111c22",
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: options.parent.clientWidth || 800,
        height: options.parent.clientHeight || 500,
      },
      audio: { noAudio: true },
      scene: {
        preload() {
          view.scene = this;
          for (const path of new Set(
            options.registry.all("sprites").map((s) => s.source),
          ))
            this.load.image(path, options.assetUrl(path));
          this.load.on("loaderror", () =>
            options.error?.("Не удалось загрузить изображение"),
          );
        },
        create() {
          for (const sprite of options.registry.all("sprites")) {
            const f = sprite.frame;
            this.textures
              .get(sprite.source)
              .add(sprite.id, 0, f.x, f.y, f.width, f.height);
          }
          view.graphics = this.add.graphics().setDepth(100000);
          this.input.mouse?.disableContextMenu();
          this.input.on("pointerdown", () => {
            void view.router.audio.unlock();
          });
          this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
            if (/^Digit[1-5]$/.test(e.code))
              view.slot = Number(e.code.at(-1)) - 1;
          });
          this.game.events.on("blur", () => view.release());
        },
        update(_time: number, delta: number) {
          view.draw(delta / 1000);
        },
      },
    });
  }
  snapshot(state: WorldState) {
    if (this.destroyed) return;
    this.state = state;
    this.receivedAt = performance.now();
    const local = state.actors.find((a) => a.id === this.options.localId);
    this.seq = Math.max(this.seq, (local?.input.seq ?? 0) + 1);
    for (const event of state.events)
      this.router.dispatch(event, local ?? state.map.spawn);
    const biome = this.options.registry.get("biomes", state.map.biomeId);
    if (biome.musicId)
      void this.router.music
        .transition(biome.musicId)
        .catch((e) => this.options.error?.(e.message));
  }
  updateSettings(settings: UserSettings) {
    this.settings = settings;
    this.router.settings(settings);
  }
  chooseMutation(id: string) {
    this.pendingMutation = id;
  }
  chooseExit(id: string) {
    this.pendingExit = id;
  }
  private release() {
    this.options.input?.({
      seq: ++this.seq,
      moveX: 0,
      moveY: 0,
      aim: 0,
      fire: false,
      interact: false,
      weaponSlot: this.slot,
    });
  }
  private visual(
    key: string,
    spriteId: string,
    x: number,
    y: number,
    depth: number,
    flip = false,
    rotation = 0,
    size?: number,
  ) {
    const scene = this.scene!,
      def = this.options.registry.get("sprites", spriteId);
    let image = this.images.get(key);
    if (!image) {
      image = scene.add.image(x, y, def.source, def.id);
      this.images.set(key, image);
    }
    image
      .setTexture(def.source, def.id)
      .setPosition(x, y)
      .setDepth(depth)
      .setOrigin(def.pivot.x / def.frame.width, def.pivot.y / def.frame.height)
      .setFlipX(flip)
      .setRotation(rotation + (def.rotationOffsetDeg * Math.PI) / 180)
      .setVisible(true)
      .setAlpha(1)
      .clearTint();
    if (size) image.setDisplaySize(size, size);
    else image.setScale(def.renderScale);
    return image;
  }
  private draw(dt: number) {
    const scene = this.scene,
      state = this.state;
    if (!scene || !this.graphics || !state) return;
    const { registry, localId } = this.options,
      map = state.map,
      g = this.graphics,
      local =
        state.actors.find((a) => a.id === localId) ??
        state.actors.find((a) => a.kind === "player");
    const mapKey = `${state.runId}:${state.depth}:${state.levelId}`;
    if (mapKey !== this.mapKey) {
      this.mapKey = mapKey;
      this.tiles.forEach((t) => t.destroy());
      this.tiles = [];
      const palette = registry.get(
        "tilePalettes",
        registry.get("biomes", map.biomeId).paletteId,
      );
      const tileDefs = new Map(palette.tiles.map((t) => [t.id, t]));
      for (let k = 0; k < map.tiles.length; k++) {
        const tile = tileDefs.get(map.tiles[k])!,
          def = registry.get("sprites", map.tileSprites?.[k] ?? tile.spriteId);
        this.tiles.push(
          scene.add
            .image(
              ((k % map.width) + 0.5) * map.tileSize,
              (Math.floor(k / map.width) + 0.5) * map.tileSize,
              def.source,
              def.id,
            )
            .setDisplaySize(map.tileSize, map.tileSize)
            .setDepth(-1000),
        );
      }
      scene.cameras.main.setBounds(
        -120,
        -120,
        map.width * map.tileSize + 240,
        map.height * map.tileSize + 240,
      );
    }
    const shake = this.router.camera.step(dt),
      camera = scene.cameras.main;
    camera.setZoom(
      Math.max(1, Math.min(3, Math.floor(scene.scale.width / 480))),
    );
    camera.centerOn(
      (local?.x ?? map.spawn.x) + shake.x,
      (local?.y ?? map.spawn.y) + shake.y,
    );
    for (const image of this.images.values()) image.setVisible(false);
    g.clear();
    g.lineStyle(2, state.completed ? 0xa9dc76 : 0x566878, 0.9);
    g.strokeCircle(map.exit.x, map.exit.y, 12);
    g.fillStyle(state.completed ? 0xa9dc76 : 0x566878, 0.3);
    g.fillCircle(map.exit.x, map.exit.y, 8);
    for (const p of state.props) {
      const d = registry.get("props", p.definitionId);
      this.visual(
        p.id,
        p.destroyed ? (d.destroyedSpriteId ?? d.spriteId) : d.spriteId,
        p.x,
        p.y,
        p.y,
      );
    }
    for (const c of state.chests) {
      const d = registry.get("chests", c.definitionId),
        clip = registry.get(
          "animations",
          c.state === "closed"
            ? d.animationSet.idle
            : (d.animationSet.open ?? d.animationSet.idle),
        );
      const f = animationFrame(
        clip,
        ((state.tick - c.openTick) * 1000) / 30,
      ).frame;
      this.visual(c.id, f.spriteId, c.x + f.offset.x, c.y + f.offset.y, c.y);
    }
    for (const p of state.pickups) {
      if (p.ownerId && p.ownerId !== localId) continue;
      const d = registry.get(
        p.kind === "pickup"
          ? "pickups"
          : p.kind === "weapon"
            ? "weapons"
            : "mutations",
        p.definitionId,
      );
      this.visual(
        p.id,
        "spriteId" in d ? d.spriteId : d.iconSpriteId,
        p.x,
        p.y + Math.sin(state.tick / 8) * 2,
        p.y,
        false,
        0,
        12,
      );
    }
    for (const a of state.actors) {
      const d = registry.get(
          a.kind === "player"
            ? "characters"
            : a.kind === "boss"
              ? "bosses"
              : "enemies",
          a.definitionId,
        ),
        set = d.animationSet,
        override=this.router.animationOverrides.get(a.id);
      if(override&&override.expires<=state.tick)this.router.animationOverrides.delete(a.id);
      const anim=override&&override.expires>state.tick?override.id:set[a.state as keyof typeof set]??set.idle;
      const clip=registry.get('animations',anim),elapsed=((state.tick-(override&&override.expires>state.tick?override.tick:a.stateTick))*1000)/30+Math.min(70,performance.now()-this.receivedAt),sample=animationFrame(clip,elapsed),frame=sample.frame;
      const frameKey=`${anim}:${sample.index}:${clip.loop?Math.floor(elapsed/clip.frames.reduce((n,f)=>n+f.durationMs,0)):0}`;
      if(this.frameKeys.get(a.id)!==frameKey){this.frameKeys.set(a.id,frameKey);for(const action of frame.events)this.router.play(action,{actorId:a.id,position:{x:a.x,y:a.y},tick:state.tick},local??map.spawn);}
      this.visual(
        a.id,
        frame.spriteId,
        a.x + frame.offset.x,
        a.y + frame.offset.y,
        a.y,
        Math.cos(a.aim) < 0,
      ).setAlpha(a.hp <= 0 ? 0.5 : 1);
      if (a.hp > 0) {
        const weapon = a.weaponIds[a.weaponSlot];
        if (weapon)
          this.visual(
            `${a.id}:weapon`,
            registry.get("weapons", weapon).spriteId,
            a.x + Math.cos(a.aim) * 8,
            a.y + Math.sin(a.aim) * 8,
            a.y + 1,
            false,
            a.aim,
            14,
          );
        if (a.kind !== "player" || a.hp < a.maxHp) {
          g.fillStyle(0x132027);
          g.fillRect(a.x - 12, a.y - a.radius - 9, 24, 3);
          g.fillStyle(a.team === "players" ? 0xa9dc76 : 0xe87970);
          g.fillRect(a.x - 12, a.y - a.radius - 9, (24 * a.hp) / a.maxHp, 3);
        }
        if (a.state === "windup") {
          g.lineStyle(1, 0xffc577, 0.8);
          g.strokeCircle(a.x, a.y, a.radius + 4 + Math.sin(state.tick) * 2);
        }
      }
      if (this.debug) {
        g.lineStyle(1, 0xff4aff, 0.6);
        g.strokeCircle(a.x, a.y, a.radius);
      }
    }
    for (const p of state.projectiles)
      this.visual(
        p.id,
        registry.get("projectiles", p.definitionId).spriteId,
        p.x,
        p.y,
        p.y + 100,
        false,
        Math.atan2(p.vy, p.vx),
        Math.max(4, p.radius * 2),
      );
    for (const b of state.beams) {
      g.lineStyle(b.width, parseInt(b.color.slice(1), 16));
      g.lineBetween(b.from.x, b.from.y, b.to.x, b.to.y);
    }
    this.router.particles.step(dt,(x,y)=>{const tx=Math.floor(x/map.tileSize),ty=Math.floor(y/map.tileSize);return tx<0||ty<0||tx>=map.width||ty>=map.height||map.solid[ty*map.width+tx];});
    for (const p of this.router.particles.pool)
      if (p.active)
        this.visual(
          p.id,
          p.spriteId,
          p.x,
          p.y,
          p.y + 1000,
          false,
          (p.rotation * Math.PI) / 180,
          Math.max(0.1, p.size * 5),
        )
          .setAlpha(p.alpha)
          .setTint(parseInt(p.color.slice(1), 16));
    for (const [key, image] of this.images)
      if (!image.visible) {
        image.destroy();
        this.images.delete(key);
      }
    this.accumulator += dt;
    if (this.accumulator >= 1 / 30 && this.options.input && local) {
      this.accumulator = 0;
      const active = document.activeElement,
        typing =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement;
      const down = (code: string) => !typing && this.keys.has(code);
      const pointer = scene.input.activePointer;
      const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2;
      this.options.input({
        seq: ++this.seq,
        moveX:
          Number(down(this.settings.controls.right)) -
          Number(down(this.settings.controls.left)),
        moveY:
          Number(down(this.settings.controls.down)) -
          Number(down(this.settings.controls.up)),
        aim: Math.atan2(world.y - local.y, world.x - local.x),
        fire: !typing && pointer.isDown && pointer.leftButtonDown(),
        interact: down(this.settings.controls.interact),
        weaponSlot: this.slot,
        ...(this.pendingMutation ? { mutationId: this.pendingMutation } : {}),
        ...(this.pendingExit ? { exitNodeId: this.pendingExit } : {}),
      });
      this.pendingMutation = undefined;
    }
  }
  dispose() {
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    this.destroyed = true;
    this.release();
    this.router.dispose();
    this.game.destroy(true);
    this.images.clear();
    this.frameKeys.clear();
    this.tiles = [];
  }
}
