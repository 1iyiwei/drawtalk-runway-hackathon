// Guide video: sprites moving along the drawn motion paths, rendered on a canvas
// and recorded in the browser. Deterministic given the scene and timing; the video
// model then restyles it (video-to-video), so the paths are specified in every frame.

import { CANVAS_SIZE, drawBackground, type Layer, type Point, type Scene } from "./scene";

// How a layer's time maps to distance along its path.
//   eased     ease in/out over the whole duration
//   constant  constant speed
//   drawn     replay the speed at which the stroke was drawn
export type Timing = "eased" | "constant" | "drawn";

// Stand-in sprites (emoji render with alpha on canvas), each with its native heading:
// the direction it faces in its image, in screen degrees (0 = right, 90 = down,
// -90 = up, 180 = left), as drawn by Apple Color Emoji. Horizontal headings are
// treated as side views (see drawSprite).
export const SPRITES: { emoji: string; heading: number }[] = [
  { emoji: "🦋", heading: -90 }, // top view, head up
  { emoji: "🐝", heading: 180 }, // side view
  { emoji: "🐦", heading: 180 },
  { emoji: "🐞", heading: -90 },
  { emoji: "🐟", heading: 180 },
  { emoji: "🐈", heading: 180 },
  { emoji: "🐕", heading: 180 },
  { emoji: "🐎", heading: 180 },
  { emoji: "🚗", heading: 180 },
  { emoji: "✈️", heading: -45 }, // pointing up-right
  { emoji: "🚀", heading: -45 },
  { emoji: "⚽", heading: -90 },
  { emoji: "🍂", heading: -90 },
  { emoji: "🎈", heading: -90 },
];

export function defaultHeading(emoji: string): number {
  return SPRITES.find((s) => s.emoji === emoji)?.heading ?? -90;
}

// Heading choices for the "faces" selector.
export const HEADINGS: { deg: number; label: string }[] = [
  { deg: -90, label: "↑ up" },
  { deg: -45, label: "↗ up-right" },
  { deg: 0, label: "→ right" },
  { deg: 45, label: "↘ down-right" },
  { deg: 90, label: "↓ down" },
  { deg: 135, label: "↙ down-left" },
  { deg: 180, label: "← left" },
  { deg: -135, label: "↖ up-left" },
];

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

// ---------------------------------------------------------------- path tracks

type Track = { pts: Point[]; cum: number[]; total: number; tEnd: number };

export function makeTrack(path: Point[]): Track {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }
  return { pts: path, cum, total: cum[cum.length - 1], tEnd: path[path.length - 1]?.t ?? 0 };
}

function atDistance(track: Track, d: number): { x: number; y: number } {
  const { pts, cum, total } = track;
  if (d <= 0) return pts[0];
  if (d >= total) return pts[pts.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (d - cum[lo]) / seg;
  return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * f, y: pts[lo].y + (pts[hi].y - pts[lo].y) * f };
}

// Distance travelled at stroke time tMs, using the recorded stroke timestamps.
function distanceAtTime(track: Track, tMs: number): number {
  const { pts, cum } = track;
  if (tMs <= 0) return 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t >= tMs) {
      const dt = pts[i].t - pts[i - 1].t || 1;
      return cum[i - 1] + (cum[i] - cum[i - 1]) * ((tMs - pts[i - 1].t) / dt);
    }
  }
  return track.total;
}

const smoothstep = (u: number) => u * u * (3 - 2 * u);

export type Pose = { x: number; y: number; angle: number; movingRight: boolean };

/** Position and heading of a layer's sprite at time fraction u in [0, 1]. */
export function poseAt(track: Track, u: number, timing: Timing): Pose {
  const v = Math.min(1, Math.max(0, u));
  const d =
    timing === "constant"
      ? v * track.total
      : timing === "eased" || track.tEnd <= 0
        ? smoothstep(v) * track.total
        : distanceAtTime(track, v * track.tEnd);
  const p = atDistance(track, d);
  // Tangent over a small window for a stable heading.
  const a = atDistance(track, d - 15);
  const b = atDistance(track, d + 15);
  let dx = b.x - a.x;
  const angle = Math.atan2(b.y - a.y, dx);
  // Facing (left/right) over a wider window to avoid flicker on near-vertical parts.
  const wa = atDistance(track, d - 40);
  const wb = atDistance(track, d + 40);
  dx = wb.x - wa.x;
  if (Math.abs(dx) < 4) {
    const s = track.pts[0];
    const e = track.pts[track.pts.length - 1];
    dx = e.x - s.x;
  }
  return { x: p.x, y: p.y, angle, movingRight: dx >= 0 };
}

// ---------------------------------------------------------------- drawing

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a)); // to (-pi, pi]

export function drawSprite(ctx: CanvasRenderingContext2D, layer: Layer, pose: Pose) {
  // Direction the sprite faces in its image (layers from older sessions lack a heading).
  const headingDeg = Number.isFinite(layer.heading) ? layer.heading : defaultHeading(layer.sprite);
  const native = (headingDeg * Math.PI) / 180;
  // Side views (facing left/right) mirror instead of turning upside down.
  const sideView = Math.abs(Math.cos(native)) > 0.9;
  const facesRight = Math.cos(native) > 0;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  if (layer.orient === "follow") {
    if (sideView) {
      // Face the direction of travel and tilt with the path, never upside down.
      const movingRight = Math.cos(pose.angle) >= 0;
      ctx.rotate(wrap(movingRight ? pose.angle : pose.angle - Math.PI));
      if (movingRight !== facesRight) ctx.scale(-1, 1);
    } else {
      // Top views rotate freely: turn the native heading onto the path tangent.
      ctx.rotate(wrap(pose.angle - native));
    }
  } else if (sideView && pose.movingRight !== facesRight) {
    // Upright: only mirror side views to face the direction of travel.
    ctx.scale(-1, 1);
  }
  ctx.font = `${layer.spriteSize}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(layer.sprite, 0, 0);
  ctx.restore();
}

function animatedLayers(scene: Scene) {
  return scene.layers
    .filter((l) => l.visible && l.path.length >= 2)
    .map((l) => ({ layer: l, track: makeTrack(l.path) }));
}

/** Draw one guide frame: clean background + every sprite at time fraction u. */
export function drawGuideFrame(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  tracks: ReturnType<typeof animatedLayers>,
  u: number,
  timing: Timing,
) {
  drawBackground(ctx, scene);
  for (const { layer, track } of tracks) drawSprite(ctx, layer, poseAt(track, u, timing));
}

/** Sprites at their start positions, for the editor preview. */
export function drawStartSprites(ctx: CanvasRenderingContext2D, scene: Scene, timing: Timing) {
  for (const { layer, track } of animatedLayers(scene)) {
    drawSprite(ctx, layer, poseAt(track, 0, timing));
  }
}

// ---------------------------------------------------------------- frames

export const GUIDE_FPS = 24; // Aleph requires <= 30 fps

function newCanvas(scene: Scene) {
  const { w, h } = CANVAS_SIZE[scene.aspect];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

/**
 * Render every guide frame deterministically (not in real time, so tab throttling
 * can't drop frames). Returns JPEG blobs; the server encodes them into an exact
 * constant-frame-rate MP4.
 */
export async function renderGuideFrames(
  scene: Scene,
  { durationSec, timing, fps = GUIDE_FPS }: { durationSec: number; timing: Timing; fps?: number },
): Promise<Blob[]> {
  const { canvas, ctx } = newCanvas(scene);
  const tracks = animatedLayers(scene);
  const n = Math.round(durationSec * fps);
  const frames: Blob[] = [];
  for (let i = 0; i < n; i++) {
    drawGuideFrame(ctx, scene, tracks, n > 1 ? i / (n - 1) : 0, timing);
    frames.push(
      await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92),
      ),
    );
  }
  return frames;
}

/** Play the guide animation live on a canvas (preview only). Returns a cancel function. */
export function playGuide(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  { durationSec, timing }: { durationSec: number; timing: Timing },
  onDone: () => void,
): () => void {
  const tracks = animatedLayers(scene);
  const t0 = performance.now();
  let raf = 0;
  const tick = () => {
    const u = Math.min(1, (performance.now() - t0) / (durationSec * 1000));
    drawGuideFrame(ctx, scene, tracks, u, timing);
    if (u < 1) raf = requestAnimationFrame(tick);
    else onDone();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
