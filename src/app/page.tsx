"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import type { Mode } from "@/lib/api-types";
import {
  type AspectRatio,
  backgroundLuminance,
  buildPrompt,
  CANVAS_SIZE,
  colorName,
  drawLayer,
  drawScene,
  flatten,
  GUIDE_NEGATIVE,
  type Layer,
  lowContrast,
  nextColor,
  PALETTE,
  type Point,
  type Scene,
} from "@/lib/scene";
import {
  drawStartSprites,
  GUIDE_FPS,
  playGuide,
  renderGuideFrames,
  SPRITES,
  type Timing,
} from "@/lib/guide-video";

type Quality = "preview" | "final";

type Run = {
  runId?: string;
  status: "rendering" | "planning" | "generating" | "done" | "error";
  guide: string; // data URL thumbnail
  guideVideo?: string; // server URL of the encoded guide video (video mode)
  mode: Mode;
  quality: Quality;
  prompt: string;
  model?: string;
  credits?: number;
  output?: string;
  local?: string | null;
  error?: string;
  started: number;
  finished?: number;
};

const MODES: { value: Mode; label: string }[] = [
  { value: "video", label: "Guide video: sprites move along paths" },
  { value: "first", label: "Guide image as first frame" },
  { value: "reference", label: "Guide image as reference" },
  { value: "clean-first", label: "Clean background first + guide reference" },
];

let layerCounter = 0;
function newLayer(layers: Layer[]): Layer {
  layerCounter += 1;
  return {
    id: `l${Date.now()}-${layerCounter}`,
    name: `Layer ${layers.length + 1}`,
    type: "motion",
    color: nextColor(layers),
    width: 8,
    visible: true,
    path: [],
    description: "",
    secondary: "",
    sprite: SPRITES[layers.length % SPRITES.length],
    spriteSize: 96,
    orient: "upright",
    flip: false,
  };
}

export default function Home() {
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [sceneText, setSceneText] = useState("A beautiful garden with flowers on a sunny day");
  const [layers, setLayers] = useState<Layer[]>(() => {
    const first = newLayer([]);
    return [
      {
        ...first,
        name: "Butterfly",
        description: "a butterfly flying",
        secondary: "wings flapping and fluttering",
      },
    ];
  });
  const [selectedId, setSelectedId] = useState<string>(() => layers[0].id);
  const [mode, setMode] = useState<Mode>("video");
  const [timing, setTiming] = useState<Timing>("eased");
  const [busyRendering, setBusyRendering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [quality, setQuality] = useState<Quality>("preview");
  const [duration, setDuration] = useState(6);
  const [useNegative, setUseNegative] = useState(true);
  const [promptOverride, setPromptOverride] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{ points: Point[]; start: number } | null>(null);

  const scene: Scene = useMemo(
    () => ({ aspect, background, sceneText, layers }),
    [aspect, background, sceneText, layers],
  );
  const selected = layers.find((l) => l.id === selectedId) ?? layers[0];
  const autoPrompt = useMemo(() => buildPrompt(scene, mode), [scene, mode]);
  const prompt = promptOverride ?? autoPrompt;
  const { w, h } = CANVAS_SIZE[aspect];

  // Background brightness for the contrast warning (white canvas = 1).
  const [bgLum, setBgLum] = useState(1);

  // ---------------------------------------------------------------- canvas

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || playing) return;
    const live = drawingRef.current;
    const shown = live
      ? { ...scene, layers: scene.layers.map((l) => (l.id === selectedId ? { ...l, path: [] } : l)) }
      : scene;
    drawScene(ctx, shown);
    if (live && selected) drawLayer(ctx, { ...selected, path: live.points });
    else if (mode === "video") drawStartSprites(ctx, scene, timing);
  }, [scene, selectedId, selected, mode, timing, playing]);

  useEffect(redraw, [redraw]);

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * w,
      y: ((e.clientY - rect.top) / rect.height) * h,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selected || playing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    drawingRef.current = { points: [{ ...p, t: 0 }], start: performance.now() };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const live = drawingRef.current;
    if (!live) return;
    const p = toCanvas(e);
    const last = live.points[live.points.length - 1];
    if ((p.x - last.x) ** 2 + (p.y - last.y) ** 2 < 4) return; // skip sub-2px jitter
    live.points.push({ ...p, t: Math.round(performance.now() - live.start) });
    redraw();
  };

  const onPointerUp = () => {
    const live = drawingRef.current;
    drawingRef.current = null;
    if (!live) return;
    // One path per layer: a new stroke replaces the old one. A click (no drag) clears it.
    const path = live.points.length >= 2 ? live.points : [];
    setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, path } : l)));
  };

  // ---------------------------------------------------------------- layers

  const updateLayer = (id: string, patch: Partial<Layer>) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLayer = () => {
    const l = newLayer(layers);
    setLayers([...layers, l]);
    setSelectedId(l.id);
  };

  const deleteLayer = (id: string) => {
    const rest = layers.filter((l) => l.id !== id);
    const next = rest.length ? rest : [newLayer([])];
    setLayers(next);
    if (id === selectedId) setSelectedId(next[0].id);
  };

  const loadBackground = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      setBackground(img);
      setBgLum(backgroundLuminance({ ...scene, background: img }));
    };
    img.src = URL.createObjectURL(file);
  };

  // ---------------------------------------------------------------- generate

  const drawnLayers = layers.filter((l) => l.visible && l.path.length >= 2);
  const canGenerate = drawnLayers.length > 0 && prompt.trim().length > 0;

  const patchRun = (started: number, patch: Partial<Run>) =>
    setRuns((rs) => rs.map((r) => (r.started === started ? { ...r, ...patch } : r)));

  // Negative prompts are only supported by some models (Veo), so they narrow routing.
  const negativeActive = useNegative && mode === "first";

  // Upload + free router dry run; saves the request as a run on the server.
  const plan = async (guide: string, frames?: Blob[]) => {
    const payload = JSON.stringify({
      quality,
      mode,
      aspectRatio: aspect,
      duration,
      prompt,
      negativePrompt: negativeActive ? GUIDE_NEGATIVE : undefined,
      guide,
      clean: background ? flatten(scene, false) : undefined,
      scene: {
        timing,
        fps: GUIDE_FPS,
        aspect,
        size: CANVAS_SIZE[aspect],
        sceneText,
        hasBackground: !!background,
        layers: layers.map((l) => ({ ...l, colorName: colorName(l.color) })),
      },
    });
    let init: RequestInit;
    if (frames) {
      // Video mode: multipart with the guide frames; the server encodes the MP4.
      const form = new FormData();
      form.append("payload", payload);
      form.append("fps", String(GUIDE_FPS));
      frames.forEach((f, i) => form.append("frames", f, `${String(i + 1).padStart(5, "0")}.jpg`));
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: payload };
    }
    const res = await fetch("/api/plan", init);
    const body = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(body.error ?? "Routing failed"), { guideVideo: body.guideVideo });
    }
    return body as {
      runId: string;
      guideVideo?: string;
      routing?: { model: string; estimatedCost?: { credits: number } };
    };
  };

  // Render the guide frames (video mode only), deterministically and faster than real time.
  const renderFrames = async (): Promise<Blob[] | undefined> => {
    if (mode !== "video") return undefined;
    setBusyRendering(true);
    try {
      return await renderGuideFrames(scene, { durationSec: duration, timing });
    } finally {
      setBusyRendering(false);
    }
  };

  // Live preview of the guide animation on the editor canvas.
  const stopPreviewRef = useRef<(() => void) | null>(null);
  const previewGuide = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    stopPreviewRef.current?.();
    setPlaying(true);
    stopPreviewRef.current = playGuide(ctx, scene, { durationSec: duration, timing }, () => {
      stopPreviewRef.current = null;
      setPlaying(false);
    });
  };

  const [route, setRoute] = useState<string | null>(null);
  const checkRoute = async () => {
    setRoute(mode === "video" ? "rendering guide…" : "checking…");
    try {
      const frames = await renderFrames();
      setRoute("checking…");
      const p = await plan(flatten(scene, true), frames);
      setRoute(`→ ${p.routing?.model} · ~${p.routing?.estimatedCost?.credits} credits`);
    } catch (e) {
      setRoute(`✕ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const generate = async () => {
    const guide = flatten(scene, true);
    const started = Date.now();
    const run: Run = {
      status: mode === "video" ? "rendering" : "planning",
      guide,
      mode,
      quality,
      prompt,
      started,
    };
    setRuns((rs) => [run, ...rs]);

    try {
      const frames = await renderFrames();
      patchRun(started, { status: "planning" });
      const planned = await plan(guide, frames);
      patchRun(started, {
        runId: planned.runId,
        guideVideo: planned.guideVideo,
        status: "generating",
        model: planned.routing?.model,
        credits: planned.routing?.estimatedCost?.credits,
      });

      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: planned.runId }),
      });
      const gen = await genRes.json();
      if (!genRes.ok) {
        throw new Error(gen.failureCode ? `${gen.error} (${gen.failureCode})` : gen.error);
      }
      patchRun(started, {
        status: "done",
        output: gen.output?.[0],
        local: gen.local,
        finished: Date.now(),
      });
    } catch (e) {
      const guideVideo = (e as { guideVideo?: string }).guideVideo;
      patchRun(started, {
        ...(guideVideo ? { guideVideo } : {}),
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        finished: Date.now(),
      });
    }
  };

  // ---------------------------------------------------------------- UI

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>DrawTalk</h1>
        <p>Draw motion paths, describe the scene, generate.</p>
      </header>

      <div className={styles.workspace}>
        <section className={styles.canvasCol}>
          <div className={styles.canvasWrap} style={{ aspectRatio: `${w} / ${h}` }}>
            <canvas
              ref={canvasRef}
              width={w}
              height={h}
              className={styles.canvas}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
          <p className={styles.hint}>
            Drawing on <strong style={{ color: selected?.color }}>{selected?.name}</strong> (
            {colorName(selected?.color ?? "")}). A new stroke replaces that layer&apos;s path.
          </p>

          <label className={styles.field}>
            Scene description
            <textarea
              rows={2}
              value={sceneText}
              onChange={(e) => setSceneText(e.target.value)}
              placeholder="A beautiful garden with flowers on a sunny day"
            />
          </label>

          <div className={styles.field}>
            <div className={styles.rowBetween}>
              <span>Prompt {promptOverride === null ? "(auto)" : "(edited)"}</span>
              {promptOverride !== null && (
                <button type="button" className={styles.link} onClick={() => setPromptOverride(null)}>
                  reset to auto
                </button>
              )}
            </div>
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPromptOverride(e.target.value)}
            />
          </div>

          <div className={styles.controls}>
            <label>
              Conditioning
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value} disabled={m.value === "clean-first" && !background}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Router
              <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
                <option value="preview">Preview (fast)</option>
                <option value="final">Final (quality)</option>
              </select>
            </label>
            <label>
              Duration
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[4, 5, 6, 8, 10].map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </label>
            {mode === "video" && (
              <label>
                Motion timing
                <select value={timing} onChange={(e) => setTiming(e.target.value as Timing)}>
                  <option value="eased">Ease in/out</option>
                  <option value="constant">Constant speed</option>
                  <option value="drawn">Drawing speed</option>
                </select>
              </label>
            )}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={negativeActive}
                disabled={mode !== "first"}
                onChange={(e) => setUseNegative(e.target.checked)}
              />
              Negative prompt: hide guides (first-frame mode; routes to Veo only)
            </label>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={!canGenerate || busyRendering}
              onClick={generate}
            >
              Generate
            </button>
            <button type="button" disabled={!canGenerate || busyRendering} onClick={checkRoute}>
              Check route (free)
            </button>
            {mode === "video" && (
              <button type="button" disabled={!canGenerate || playing} onClick={previewGuide}>
                {playing ? "Playing…" : "Preview motion"}
              </button>
            )}
            {route && <span className={styles.hint}>{route}</span>}
          </div>
          {!drawnLayers.length && <p className={styles.hint}>Draw a path first.</p>}

        </section>

        <aside className={styles.panel}>
          <h2>Canvas</h2>
          <div className={styles.controls}>
            <label>
              Aspect
              <select value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
                <option value="16:9">16:9 (1280×720)</option>
                <option value="9:16">9:16 (720×1280)</option>
              </select>
            </label>
          </div>
          <div className={styles.bgRow}>
            <label className={styles.fileBtn}>
              Load background
              <input type="file" accept="image/*" onChange={(e) => loadBackground(e.target.files?.[0])} />
            </label>
            {background && (
              <button
                type="button"
                onClick={() => {
                  setBackground(null);
                  setBgLum(1);
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div className={styles.rowBetween}>
            <h2>Motion layers</h2>
            <button type="button" onClick={addLayer}>
              + Layer
            </button>
          </div>
          <ul className={styles.layers}>
            {layers.map((l) => (
              <li
                key={l.id}
                className={l.id === selectedId ? styles.layerSelected : styles.layer}
                onClick={() => setSelectedId(l.id)}
              >
                <div className={styles.rowBetween}>
                  <input
                    className={styles.layerName}
                    value={l.name}
                    onChange={(e) => updateLayer(l.id, { name: e.target.value })}
                  />
                  <label className={styles.check} title="Visible">
                    <input
                      type="checkbox"
                      checked={l.visible}
                      onChange={(e) => updateLayer(l.id, { visible: e.target.checked })}
                    />
                    show
                  </label>
                </div>
                <input
                  className={styles.desc}
                  value={l.description}
                  placeholder="what moves along it, e.g. a butterfly flying"
                  onChange={(e) => updateLayer(l.id, { description: e.target.value })}
                />
                <input
                  className={styles.desc}
                  value={l.secondary}
                  placeholder="motion details, e.g. wings flapping fast"
                  onChange={(e) => updateLayer(l.id, { secondary: e.target.value })}
                />
                {mode === "video" && (
                  <div className={styles.spriteRow}>
                    <select
                      aria-label="Sprite"
                      value={l.sprite}
                      onChange={(e) => updateLayer(l.id, { sprite: e.target.value })}
                    >
                      {SPRITES.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                    <label className={styles.inline} title="Sprite size">
                      size
                      <input
                        type="range"
                        min={32}
                        max={240}
                        value={l.spriteSize}
                        onChange={(e) => updateLayer(l.id, { spriteSize: Number(e.target.value) })}
                      />
                    </label>
                    <select
                      aria-label="Orientation"
                      value={l.orient}
                      onChange={(e) => updateLayer(l.id, { orient: e.target.value as Layer["orient"] })}
                    >
                      <option value="upright">upright</option>
                      <option value="follow">follow path</option>
                    </select>
                    <label className={styles.check} title="Sprite image faces right">
                      <input
                        type="checkbox"
                        checked={l.flip}
                        onChange={(e) => updateLayer(l.id, { flip: e.target.checked })}
                      />
                      flip
                    </label>
                  </div>
                )}
                <div className={styles.swatches}>
                  {PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      aria-label={c.name}
                      className={l.color === c.hex ? styles.swatchOn : styles.swatch}
                      style={{ background: c.hex }}
                      onClick={() => updateLayer(l.id, { color: c.hex })}
                    />
                  ))}
                </div>
                <div className={styles.rowBetween}>
                  <label className={styles.inline}>
                    width
                    <input
                      type="range"
                      min={2}
                      max={24}
                      value={l.width}
                      onChange={(e) => updateLayer(l.id, { width: Number(e.target.value) })}
                    />
                  </label>
                  <span>
                    <button type="button" onClick={() => updateLayer(l.id, { path: [] })}>
                      Clear
                    </button>{" "}
                    <button type="button" onClick={() => deleteLayer(l.id)}>
                      Delete
                    </button>
                  </span>
                </div>
                {l.visible && lowContrast(l.color, bgLum) && (
                  <p className={styles.warn}>Low contrast with the background — pick another color.</p>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {runs.length > 0 && (
        <section className={styles.runs}>
          <h2>Runs</h2>
          {runs.map((r) => (
            <article key={r.started} className={styles.run}>
              {r.guideVideo ? (
                <video className={styles.runGuide} src={r.guideVideo} controls autoPlay loop muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.guide} alt="Guide image" className={styles.runGuide} />
              )}
              <div className={styles.runOut}>
                {r.status === "done" && (r.local || r.output) ? (
                  <video src={r.local ?? r.output} controls autoPlay loop muted playsInline />
                ) : (
                  <div className={styles.placeholder}>
                    {r.status === "rendering" && "Rendering guide frames…"}
                    {r.status === "planning" && "Uploading & routing…"}
                    {r.status === "generating" && "Generating… (a minute or two)"}
                    {r.status === "error" && <span className={styles.warn}>{r.error}</span>}
                  </div>
                )}
              </div>
              <div className={styles.runMeta}>
                <strong>{r.model ?? "…"}</strong> · {r.quality} · {MODES.find((m) => m.value === r.mode)?.label}
                {r.credits !== undefined && <> · ~{r.credits} credits</>}
                {r.finished && <> · {Math.round((r.finished - r.started) / 1000)}s</>}
                {r.runId && <> · run {r.runId}</>}
                <details>
                  <summary>prompt</summary>
                  <p>{r.prompt}</p>
                </details>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
