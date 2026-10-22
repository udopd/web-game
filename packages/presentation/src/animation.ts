import type { Definition } from "../../content-schemas/src/definitions";
export function animationFrame(
  clip: Definition<"animations">,
  elapsedMs: number,
) {
  elapsedMs = Math.max(0, elapsedMs);
  const duration = clip.frames.reduce((sum, f) => sum + f.durationMs, 0);
  let t = clip.loop ? elapsedMs % duration : Math.min(elapsedMs, duration - 1);
  for (let i = 0; i < clip.frames.length; i++) {
    t -= clip.frames[i].durationMs;
    if (t < 0)
      return {
        index: i,
        frame: clip.frames[i],
        complete: !clip.loop && elapsedMs >= duration,
      };
  }
  return { index: 0, frame: clip.frames[0], complete: false };
}
