// Scene model shared by the editor and the flattener. Client-safe (no secrets).

export type Point = { x: number; y: number; t: number }; // canvas px, ms since stroke start

export type Layer = {
  id: string;
  name: string;
  type: "motion" | "camera"; // camera: the path is where the view center travels
  color: string; // one of PALETTE hex values
  width: number;
  visible: boolean;
  path: Point[]; // one path per layer; redrawing replaces it
  description: string; // "a butterfly flutters"
  secondary: string; // secondary motion, e.g. "wings flapping fast" (prompt only)
  // Guide-video sprite (v1): a stand-in emoji that moves along the path.
  sprite: string;
  spriteSize: number; // px at canvas resolution
  orient: "follow" | "upright"; // align with the path, or stay upright (mirror only)
  heading: number; // direction the sprite faces in its image, screen degrees (-90 = up)
  // Motion modifiers drawn into the guide (secondary motion); see guide-video.ts.
  flap: number; // wing beats per second, 0 = off
  bob: number; // px perpendicular to the path
  wobble: number; // degrees of rotation jitter
  parallax?: number; // motion layers under a moving camera: 1 = moves with the background,
  //                    > 1 = closer to the camera (moves more), < 1 = farther
  zoom?: [number, number]; // camera layers: zoom at start and end (1 = whole background)
  timing?: "eased" | "constant" | "drawn"; // camera layers: own timing (default eased)
};

export type AspectRatio = "16:9" | "9:16";

export type Scene = {
  aspect: AspectRatio;
  background: HTMLImageElement | null;
  sceneText: string; // overall description, e.g. "a beautiful garden"
  layers: Layer[];
};

export const CANVAS_SIZE: Record<AspectRatio, { w: number; h: number }> = {
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
};

// Named swatches so the prompt can refer to each path by color.
export const PALETTE: { name: string; hex: string }[] = [
  { name: "black", hex: "#111111" },
  { name: "red", hex: "#e53935" },
  { name: "blue", hex: "#1e63e9" },
  { name: "green", hex: "#2e9e44" },
  { name: "orange", hex: "#fb8c00" },
  { name: "purple", hex: "#8e24aa" },
  { name: "white", hex: "#ffffff" },
];

export function colorName(hex: string): string {
  return PALETTE.find((c) => c.hex === hex)?.name ?? hex;
}

export function nextColor(layers: Layer[]): string {
  const used = new Set(layers.map((l) => l.color));
  return (PALETTE.find((c) => !used.has(c.hex)) ?? PALETTE[0]).hex;
}

// ---------------------------------------------------------------- drawing

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export function drawBackground(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { w, h } = CANVAS_SIZE[scene.aspect];
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  if (scene.background) drawCover(ctx, scene.background, w, h);
}

// Smooth polyline through the points (quadratic curves via midpoints).
function strokePath(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

// Direction at the end of the path, measured over the last ~20 px for stability.
function endAngle(pts: Point[]): number {
  const last = pts[pts.length - 1];
  for (let i = pts.length - 2; i >= 0; i--) {
    const dx = last.x - pts[i].x;
    const dy = last.y - pts[i].y;
    if (dx * dx + dy * dy > 400) return Math.atan2(dy, dx);
  }
  const first = pts[0];
  return Math.atan2(last.y - first.y, last.x - first.x);
}

export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer) {
  const pts = layer.path;
  if (!layer.visible || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = layer.color;
  ctx.fillStyle = layer.color;
  ctx.lineWidth = layer.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (layer.type === "camera") ctx.setLineDash([layer.width * 3, layer.width * 2.5]);
  strokePath(ctx, pts);
  ctx.setLineDash([]);

  // Start dot
  ctx.beginPath();
  ctx.arc(pts[0].x, pts[0].y, layer.width * 1.8 + 3, 0, Math.PI * 2);
  ctx.fill();

  // Arrowhead at the end
  const end = pts[pts.length - 1];
  const a = endAngle(pts);
  const len = layer.width * 3 + 14;
  ctx.beginPath();
  ctx.moveTo(end.x + Math.cos(a) * len * 0.4, end.y + Math.sin(a) * len * 0.4);
  ctx.lineTo(end.x - Math.cos(a - 0.5) * len, end.y - Math.sin(a - 0.5) * len);
  ctx.lineTo(end.x - Math.cos(a + 0.5) * len, end.y - Math.sin(a + 0.5) * len);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene) {
  drawBackground(ctx, scene);
  for (const layer of scene.layers) drawLayer(ctx, layer);
}

/** Render the scene at full model resolution and return a PNG data URL. */
export function flatten(scene: Scene, withPaths = true): string {
  const { w, h } = CANVAS_SIZE[scene.aspect];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (withPaths) drawScene(ctx, scene);
  else drawBackground(ctx, scene);
  return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------- prompt

export const GUIDE_NEGATIVE =
  "drawn lines, colored paths, arrows, dots, markers, annotations, sketch strokes, text";

// How the drawing conditions the model; mirrors Mode in api-types.
export type PromptMode = "first" | "reference" | "clean-first" | "video" | "video-reference";

// Secondary motion for a layer ("wings flapping fast"), or a generic default.
function secondaryMotion(l: Layer): string {
  return l.secondary.trim() || "natural, lifelike motion";
}

/** The camera layer, if it has a visible path. */
export function cameraLayer(scene: Scene): Layer | undefined {
  return scene.layers.find((l) => l.type === "camera" && l.visible && l.path.length >= 2);
}

export const DEFAULT_ZOOM: [number, number] = [1.5, 1.5];

/** "the camera pans right and pushes in" — from the camera path and zoom. */
export function describeCamera(camera: Layer, aspect: AspectRatio): string {
  const { w, h } = CANVAS_SIZE[aspect];
  const pts = camera.path;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = (b.x - a.x) / w;
  const dy = (b.y - a.y) / h;
  const [z0, z1] = camera.zoom ?? DEFAULT_ZOOM;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);

  const moves: string[] = [];
  if (Math.abs(dx) > 0.06) moves.push(`pans ${dx > 0 ? "right" : "left"}`);
  if (Math.abs(dy) > 0.06) moves.push(`tilts ${dy > 0 ? "down" : "up"}`);
  if (z1 / z0 > 1.08) moves.push("pushes in");
  else if (z0 / z1 > 1.08) moves.push("pulls back");
  let text = moves.length
    ? `the camera smoothly ${moves.length > 1 ? `${moves.slice(0, -1).join(", ")} and ${moves[moves.length - 1]}` : moves[0]}`
    : "the camera drifts slightly";
  if (chord > 0 && length > 1.3 * chord) text += " along a curved path";
  const style = camera.description.trim();
  return style ? `${text} (${style})` : text;
}

export function buildPrompt(scene: Scene, mode: PromptMode = "first"): string {
  const camera = cameraLayer(scene);
  const drawn = scene.layers.filter((l) => l.type !== "camera" && l.visible && l.path.length >= 2);
  const parts: string[] = [];
  if (scene.sceneText.trim()) parts.push(scene.sceneText.trim().replace(/\.?$/, "."));
  if (!drawn.length && !camera) return parts.join(" ");
  const who = (l: Layer) => (l.description || l.name).trim();
  const cameraText = camera ? capitalize(describeCamera(camera, scene.aspect)) : "";

  if (!drawn.length && camera) {
    // Camera move only: no subjects to follow.
    const c = colorName(camera.color);
    if (mode === "video") {
      parts.push(
        `The input video is a camera-motion guide over this scene. ${cameraText}, exactly as in the input video, with natural, lifelike detail and subtle ambient motion.`,
      );
    } else if (mode === "video-reference") {
      parts.push(
        `The reference video shows only the camera movement. ${cameraText}, as in the reference video, with natural, lifelike detail and subtle ambient motion.`,
      );
    } else if (mode === "first") {
      parts.push(
        `${cameraText}, following the dashed ${c} path. The dashed line, dot and arrow are only a camera guide: they are not part of the scene, disappear immediately, and never appear in the output video.`,
      );
    } else {
      parts.push(
        `The reference image is only a camera diagram: the dashed ${c} line shows the camera's path, from its dot to its arrow. ${cameraText}. The output video shows only the real scene: no drawn lines, dots, arrows or other diagram marks appear in any frame.`,
      );
    }
    return parts.join(" ");
  }

  if (mode === "video") {
    // Video-to-video: keep the paths from the guide, but not its stiff icon motion.
    parts.push("The input video is only a rough motion guide made of flat icons.");
    for (const l of drawn) {
      parts.push(
        `The ${l.sprite} icon becomes ${who(l)}, keeping its path and timing, with ${secondaryMotion(l)}.`,
      );
    }
    parts.push(
      "Replace every icon with the real, fully animated subject (never a flat icon sliding across the frame), with natural lighting and detail.",
    );
    parts.push(camera ? `${cameraText}, exactly as in the input video.` : "Keep the camera still.");
    return parts.join(" ");
  }

  if (mode === "video-reference") {
    // Guide video as a reference only: looser, so the model animates more freely.
    parts.push(
      "The reference video is only a rough motion guide made of flat icons: it shows where and when each subject moves.",
    );
    for (const l of drawn) {
      parts.push(
        `The ${l.sprite} icon marks ${who(l)}, which travels the same route with the same timing, with ${secondaryMotion(l)}.`,
      );
    }
    parts.push(
      "The output video shows only the real, fully animated subjects in the real scene: no icons, emoji, lines or other guide marks.",
    );
    parts.push(camera ? `${cameraText}, as in the reference video.` : "Keep the camera still.");
    return parts.join(" ");
  }

  if (mode === "first") {
    // The drawing is the first frame.
    for (const l of drawn) {
      const c = colorName(l.color);
      parts.push(
        `${capitalize(who(l))}, following the ${c} path from the ${c} dot to the ${c} arrow, with ${secondaryMotion(l)}.`,
      );
    }
    if (camera) parts.push(`${cameraText}, following the dashed ${colorName(camera.color)} path.`);
    parts.push(
      "The colored lines, dots and arrows are only motion guides: they are not part of the scene, disappear immediately, and never appear in the output video.",
    );
    return parts.join(" ");
  }

  // reference / clean-first: the drawing is a reference image, not a frame.
  parts.push(
    "The reference image is only a motion diagram: each colored line shows where a subject travels, starting at its dot and ending at its arrow.",
  );
  for (const l of drawn) {
    const c = colorName(l.color);
    parts.push(
      `${capitalize(who(l))}, moving along the route of the ${c} line from its dot to its arrow, with ${secondaryMotion(l)}.`,
    );
  }
  if (camera) parts.push(`${cameraText}, following the dashed ${colorName(camera.color)} line.`);
  parts.push(
    "The output video shows only the real scene: no drawn lines, paths, dots, arrows or other diagram marks appear in any frame.",
  );
  return parts.join(" ");
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Relative luminance contrast between a layer color and the average background. */
export function lowContrast(hex: string, bgLuminance: number): boolean {
  const n = parseInt(hex.slice(1), 16);
  const lum = luminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const [a, b] = lum > bgLuminance ? [lum, bgLuminance] : [bgLuminance, lum];
  return (a + 0.05) / (b + 0.05) < 2;
}

export function luminance(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Average luminance of the background (white when blank). */
export function backgroundLuminance(scene: Scene): number {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 32, 18);
  if (scene.background) drawCover(ctx, scene.background, 32, 18);
  const d = ctx.getImageData(0, 0, 32, 18).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += luminance(d[i], d[i + 1], d[i + 2]);
  return sum / (d.length / 4);
}
