"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import { type Mode, type RunProgress, type RunSummary, VIDEO_MODES } from "@/lib/api-types";
import {
  type AspectRatio,
  backgroundLuminance,
  buildPrompt,
  CANVAS_SIZE,
  colorName,
  DEFAULT_ZOOM,
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
  defaultHeading,
  defaultMotion,
  MAX_FLAP_HZ,
  motionOf,
  drawStartSprites,
  GUIDE_FPS,
  HEADINGS,
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
  restored?: boolean; // loaded from disk after a page reload
  taskStatus?: RunProgress["taskStatus"]; // Runway task status while generating
  progress?: number; // 0-1
};

const MODES: { value: Mode; label: string }[] = [
  { value: "video", label: "Guide video: sprites move along paths" },
  { value: "video-reference", label: "Guide video as reference (looser motion)" },
  { value: "first", label: "Guide image as first frame" },
  { value: "reference", label: "Guide image as reference" },
  { value: "clean-first", label: "Clean background first + guide reference" },
];

function fromSummary(s: RunSummary): Run {
  const url = (file: string) => `/api/runs/${s.runId}/${file}`;
  return {
    runId: s.runId,
    status: s.status,
    guide: url("guide.png"),
    guideVideo: s.hasGuideVideo ? url("guide.mp4") : undefined,
    mode: s.mode ?? "first",
    quality: s.quality ?? "preview",
    prompt: s.prompt ?? "",
    model: s.model,
    credits: s.credits,
    output: s.output,
    local: s.hasOutput ? url("output.mp4") : null,
    error: s.error,
    started: s.started,
    finished: s.finished,
    restored: true,
  };
}

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
    sprite: SPRITES[layers.length % SPRITES.length].emoji,
    heading: SPRITES[layers.length % SPRITES.length].heading,
    ...SPRITES[layers.length % SPRITES.length].motion,
    spriteSize: 96,
    orient: "follow",
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
  const isVideo = VIDEO_MODES.includes(mode);
  const [timing, setTiming] = useState<Timing>("drawn");
  const [busyRendering, setBusyRendering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [quality, setQuality] = useState<Quality>("preview");
  const [duration, setDuration] = useState(4);
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
    else if (isVideo) drawStartSprites(ctx, scene, timing);
  }, [scene, selectedId, selected, isVideo, timing, playing]);

  useEffect(redraw, [redraw]);

  // Canvas coordinates of a pointer event, or null if the canvas has no layout size.
  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * w,
      y: ((e.clientY - rect.top) / rect.height) * h,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selected || playing) return;
    const p = toCanvas(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = { points: [{ ...p, t: 0 }], start: performance.now() };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const live = drawingRef.current;
    if (!live) return;
    const p = toCanvas(e);
    if (!p) return;
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

  // One camera layer: its path is where the view center travels.
  const hasCamera = layers.some((l) => l.type === "camera");
  const addCamera = () => {
    const l: Layer = {
      ...newLayer(layers),
      name: "Camera",
      type: "camera",
      width: 6,
      sprite: "",
      flap: 0,
      bob: 0,
      wobble: 0,
      zoom: [...DEFAULT_ZOOM],
    };
    setLayers([...layers, l]);
    setSelectedId(l.id);
  };

  const deleteLayer = (id: string) => {
    const rest = layers.filter((l) => l.id !== id);
    const next = rest.length ? rest : [newLayer([])];
    setLayers(next);
    if (id === selectedId) setSelectedId(next[0].id);
  };

  const applyBackground = (src: string) => {
    const img = new Image();
    img.onload = () => {
      setBackground(img);
      setBgLum(backgroundLuminance({ ...scene, background: img }));
    };
    img.src = src;
  };

  const loadBackground = (file: File | undefined) => {
    if (file) applyBackground(URL.createObjectURL(file));
  };

  // Generate a background image from a prompt (Model Router, image modality).
  const [bgPrompt, setBgPrompt] = useState<string | null>(null); // null = use scene text
  const [bgStatus, setBgStatus] = useState<{
    busy: boolean;
    text: string;
    started?: number;
    taskStatus?: RunProgress["taskStatus"];
    progress?: number;
  } | null>(null);
  const generateBackground = async () => {
    const promptText = (bgPrompt ?? sceneText).trim();
    if (!promptText) return;
    const started = Date.now();
    setBgStatus({ busy: true, text: "Generating background…", started });
    // Poll Runway task progress while the request runs.
    const jobId = `bg-${started}-${Math.random().toString(36).slice(2, 8)}`;
    const poll = setInterval(async () => {
      const r = await fetch(`/api/background/progress?job=${jobId}`).catch(() => null);
      if (!r?.ok) return;
      const p = (await r.json()) as RunProgress;
      setBgStatus((b) =>
        b?.busy && b.started === started
          ? { ...b, taskStatus: p.taskStatus ?? b.taskStatus, progress: p.progress ?? b.progress }
          : b,
      );
    }, 2500);
    try {
      const res = await fetch("/api/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, aspectRatio: aspect, quality, jobId }),
      }).finally(() => clearInterval(poll));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Background generation failed");
      applyBackground(body.dataUrl);
      setBgStatus({
        busy: false,
        text: `✓ ${body.model ?? "generated"}${body.credits !== undefined ? ` · ~${body.credits} credits` : ""}`,
      });
    } catch (e) {
      setBgStatus({ busy: false, text: `✕ ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  // ---------------------------------------------------------------- generate

  const drawnLayers = layers.filter((l) => l.visible && l.path.length >= 2);
  const canGenerate = drawnLayers.length > 0 && prompt.trim().length > 0;

  const patchRun = (started: number, patch: Partial<Run>) =>
    setRuns((rs) => rs.map((r) => (r.started === started ? { ...r, ...patch } : r)));

  // Restore runs from disk after a page reload (generation continues on the server),
  // and poll while any restored run is still generating.
  const restoredPending = runs.some((r) => r.restored && r.status === "generating");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch("/api/runs").catch(() => null);
      if (!res?.ok || cancelled) return;
      const { runs: saved } = (await res.json()) as { runs: RunSummary[] };
      setRuns((current) => {
        const byId = new Map(current.filter((r) => r.runId).map((r) => [r.runId, r]));
        const next = current.map((r) => {
          const s = r.restored && saved.find((x) => x.runId === r.runId);
          return s ? { ...r, ...fromSummary(s) } : r;
        });
        for (const s of saved) if (!byId.has(s.runId)) next.push(fromSummary(s));
        return next.sort((a, b) => b.started - a.started);
      });
    };
    load();
    const timer = restoredPending ? setInterval(load, 10_000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [restoredPending]);

  // Poll Runway task progress for generating runs (Runway updates at most every ~5 s).
  const generatingIds = runs
    .filter((r) => r.status === "generating" && r.runId)
    .map((r) => r.runId!)
    .join(",");
  const [now, setNow] = useState(0); // clock for elapsed time, ticks while generating
  useEffect(() => {
    if (!generatingIds) return;
    const ids = generatingIds.split(",");
    const poll = async () => {
      for (const id of ids) {
        const res = await fetch(`/api/runs/${id}/progress`).catch(() => null);
        if (!res?.ok) continue;
        const p = (await res.json()) as RunProgress;
        setRuns((rs) =>
          rs.map((r) =>
            r.runId === id && r.status === "generating"
              ? { ...r, taskStatus: p.taskStatus ?? r.taskStatus, progress: p.progress ?? r.progress }
              : r,
          ),
        );
      }
    };
    poll();
    const pollTimer = setInterval(poll, 5000);
    return () => clearInterval(pollTimer);
  }, [generatingIds]);

  // Tick the elapsed-time display while any run is in progress.
  const anyActive =
    runs.some((r) => r.status !== "done" && r.status !== "error") || !!bgStatus?.busy;
  useEffect(() => {
    if (!anyActive) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [anyActive]);

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
    if (!isVideo) return undefined;
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
    setRoute(isVideo ? "rendering guide…" : "checking…");
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
      status: isVideo ? "rendering" : "planning",
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
        <h1>DrawTalkRunway</h1>
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
            {isVideo && (
              <label>
                Sprite timing
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
            {isVideo && (
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
          <label className={styles.field}>
            Background prompt
            <textarea
              rows={2}
              value={bgPrompt ?? sceneText}
              onChange={(e) => setBgPrompt(e.target.value)}
              placeholder="e.g. a sunlit flower garden, wide shot"
            />
          </label>
          <div className={styles.bgRow}>
            <button
              type="button"
              disabled={bgStatus?.busy || !(bgPrompt ?? sceneText).trim()}
              onClick={generateBackground}
              title={`Uses the ${quality === "final" ? "Final (2k)" : "Preview (1k)"} router`}
            >
              {bgStatus?.busy ? "Generating…" : "Generate background"}
            </button>
            {bgPrompt !== null && (
              <button type="button" className={styles.link} onClick={() => setBgPrompt(null)}>
                use scene text
              </button>
            )}
          </div>
          {bgStatus?.busy ? (
            <ProgressBar
              {...taskProgress(bgStatus.taskStatus, bgStatus.progress, "Generating background")}
              elapsed={Math.max(0, Math.round((now - (bgStatus.started ?? now)) / 1000))}
            />
          ) : (
            bgStatus && <p className={styles.hint}>{bgStatus.text}</p>
          )}
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
            <h2>Layers</h2>
            <span>
              <button type="button" onClick={addLayer}>
                + Layer
              </button>{" "}
              <button
                type="button"
                onClick={addCamera}
                disabled={hasCamera}
                title={hasCamera ? "There is already a camera layer" : "Draw where the camera looks"}
              >
                + Camera
              </button>
            </span>
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
                  placeholder={
                    l.type === "camera"
                      ? "camera style, e.g. slow cinematic dolly"
                      : "what moves along it, e.g. a butterfly flying"
                  }
                  onChange={(e) => updateLayer(l.id, { description: e.target.value })}
                />
                {l.type === "camera" ? (
                  <div className={styles.spriteRow}>
                    {([0, 1] as const).map((i) => (
                      <label
                        key={i}
                        className={styles.inline}
                        title="Zoom into the background (1 = whole image); room to pan"
                      >
                        zoom {i === 0 ? "start" : "end"}
                        <input
                          type="range"
                          min={1}
                          max={3}
                          step={0.1}
                          value={(l.zoom ?? DEFAULT_ZOOM)[i]}
                          onChange={(e) => {
                            const zoom: [number, number] = [...(l.zoom ?? DEFAULT_ZOOM)];
                            zoom[i] = Number(e.target.value);
                            updateLayer(l.id, { zoom });
                          }}
                        />
                        <span className={styles.value}>{(l.zoom ?? DEFAULT_ZOOM)[i].toFixed(1)}×</span>
                      </label>
                    ))}
                    <label className={styles.inline} title="Camera speed along its path">
                      timing
                      <select
                        value={l.timing ?? "eased"}
                        onChange={(e) => updateLayer(l.id, { timing: e.target.value as Timing })}
                      >
                        <option value="eased">ease in/out</option>
                        <option value="constant">constant</option>
                        <option value="drawn">drawing speed</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <input
                    className={styles.desc}
                    value={l.secondary}
                    placeholder="motion details, e.g. wings flapping fast"
                    onChange={(e) => updateLayer(l.id, { secondary: e.target.value })}
                  />
                )}
                {isVideo && l.type !== "camera" && (
                  <div className={styles.spriteRow}>
                    <select
                      aria-label="Sprite"
                      value={l.sprite}
                      onChange={(e) =>
                        updateLayer(l.id, {
                          sprite: e.target.value,
                          heading: defaultHeading(e.target.value),
                          ...defaultMotion(e.target.value),
                        })
                      }
                    >
                      {SPRITES.map(({ emoji }) => (
                        <option key={emoji} value={emoji}>
                          {emoji}
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
                      <option value="follow">follow path</option>
                      <option value="upright">upright</option>
                    </select>
                    <label className={styles.inline} title="Direction the sprite faces in its image">
                      faces
                      <select
                        value={Number.isFinite(l.heading) ? l.heading : defaultHeading(l.sprite)}
                        onChange={(e) => updateLayer(l.id, { heading: Number(e.target.value) })}
                      >
                        {HEADINGS.map((h) => (
                          <option key={h.deg} value={h.deg}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(
                      [
                        ["flap", "Hz", 0, MAX_FLAP_HZ, 0.5, "wing beats per second"],
                        ["bob", "px", 0, 40, 1, "up/down drift across the path"],
                        ["wobble", "°", 0, 30, 1, "rotation jitter"],
                      ] as const
                    ).map(([key, unit, min, max, step, title]) => (
                      <label key={key} className={styles.inline} title={title}>
                        {key}
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={motionOf(l)[key]}
                          onChange={(e) => updateLayer(l.id, { [key]: Number(e.target.value) })}
                        />
                        <span className={styles.value}>
                          {motionOf(l)[key]}
                          {unit}
                        </span>
                      </label>
                    ))}
                    {hasCamera && (
                      <label
                        className={styles.inline}
                        title="How much this layer moves with the camera: 1 = with the background, >1 = closer (moves more)"
                      >
                        parallax
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.1}
                          value={l.parallax ?? 1}
                          onChange={(e) => updateLayer(l.id, { parallax: Number(e.target.value) })}
                        />
                        <span className={styles.value}>{(l.parallax ?? 1).toFixed(1)}</span>
                      </label>
                    )}
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
                    {r.status !== "error" && <RunProgressBar run={r} now={now} />}
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

// Label and fraction (null = indeterminate) for a Runway task's status.
function taskProgress(
  taskStatus: RunProgress["taskStatus"],
  progress: number | undefined,
  verb: string,
): { label: string; fraction: number | null } {
  if (taskStatus === "RUNNING") {
    const f = progress ?? 0;
    return { label: `${verb} ${Math.round(f * 100)}%`, fraction: f };
  }
  if (taskStatus === "THROTTLED") return { label: "Queued (rate limit), will start automatically…", fraction: null };
  if (taskStatus === "PENDING") return { label: "Waiting for a GPU…", fraction: null };
  if (taskStatus === "SUCCEEDED") return { label: "Downloading…", fraction: 1 };
  return { label: "Submitting…", fraction: null };
}

function RunProgressBar({ run, now }: { run: Run; now: number }) {
  const elapsed = Math.max(0, Math.round((now - run.started) / 1000));
  const { label, fraction } =
    run.status === "rendering"
      ? { label: "Rendering guide frames…", fraction: null }
      : run.status === "planning"
        ? { label: "Uploading & routing…", fraction: null }
        : taskProgress(run.taskStatus, run.progress, "Generating");
  return <ProgressBar label={label} fraction={fraction} elapsed={elapsed} />;
}

function ProgressBar({ label, fraction, elapsed }: { label: string; fraction: number | null; elapsed: number }) {
  return (
    <div className={styles.progress}>
      <div className={styles.progressLabel}>
        <span>{label}</span>
        <span>{elapsed}s</span>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      >
        <div
          className={fraction === null ? styles.progressIndeterminate : styles.progressFill}
          style={fraction === null ? undefined : { width: `${Math.max(2, fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}
