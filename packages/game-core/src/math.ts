import type { Vec2 } from "../../shared-types/src/index";
export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export const distanceSq = (a: Vec2, b: Vec2) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const quantize = (v: number) => Math.round(v * 1024) / 1024;
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0 || 0x9e3779b9;
  }
  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  int(min: number, max: number) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error("Cannot sample empty set");
    return items[this.int(0, items.length - 1)];
  }
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const total = items.reduce((s, v) => s + weight(v), 0);
    if (!(total > 0)) throw new Error("Empty weighted distribution");
    let roll = this.next() * total;
    for (const item of items) {
      roll -= weight(item);
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }
}
export function segmentCircle(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  r: number,
): number | null {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    fx = a.x - c.x,
    fy = a.y - c.y;
  const aa = dx * dx + dy * dy;
  if (!aa) return distanceSq(a, c) <= r * r ? 0 : null;
  const bb = 2 * (fx * dx + fy * dy),
    cc = fx * fx + fy * fy - r * r;
  if (cc <= 0) return 0;
  const d = bb * bb - 4 * aa * cc;
  if (d < 0) return null;
  const t = (-bb - Math.sqrt(d)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}
export function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export type Collider={shape:'circle';radius:number}|{shape:'box';width:number;height:number};
export function colliderRadius(c:Collider){return c.shape==='circle'?c.radius:Math.max(c.width,c.height)/2;}
export function circleCollider(point:{x:number;y:number},radius:number,center:{x:number;y:number},c:Collider){
 if(c.shape==='circle')return distanceSq(point,center)<(radius+c.radius)**2;
 const dx=Math.max(0,Math.abs(point.x-center.x)-c.width/2),dy=Math.max(0,Math.abs(point.y-center.y)-c.height/2);return dx*dx+dy*dy<radius*radius;
}
export function segmentCollider(from:{x:number;y:number},to:{x:number;y:number},center:{x:number;y:number},c:Collider,padding=0):number|null{
 if(c.shape==='circle')return segmentCircle(from,to,center,c.radius+padding);
 let low=0,high=1;for(const[origin,delta,min,max]of[[from.x,to.x-from.x,center.x-c.width/2-padding,center.x+c.width/2+padding],[from.y,to.y-from.y,center.y-c.height/2-padding,center.y+c.height/2+padding]]){if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return null;}else{const a=(min-origin)/delta,b=(max-origin)/delta;low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));if(low>high)return null;}}return low;
}
