# DrawTalkRunway — Runway Hackathon (Sept 30, 2026)

Draw motion paths, describe the scene, and generate a video that follows them, using
[Runway Dev](https://docs.dev.runwayml.com) Model Routers. Built for the
[Runway Hackathon](https://hackathon.runway.com/).
Design notes: [draw-talk.md](draw-talk.md).

## Demo videos

**Hackathon submission video (3 min)**

[![DrawTalkRunway: final hackathon submission video](https://img.youtube.com/vi/n5Zx8ZG9J1Y/hqdefault.jpg)](https://youtu.be/n5Zx8ZG9J1Y)

**Full end-to-end sessions** (unedited, including generation wait times; "code v*" refers to the versions in the [timeline](#hackathon-timeline)):

<table>
<tr>
<td align="center" width="50%">
<a href="https://youtu.be/_x--_rO2MsI"><img src="https://img.youtube.com/vi/_x--_rO2MsI/hqdefault.jpg" width="360" alt="Session 1: Motion paths for sprites, guide video as reference (code v1)"></a><br>
<b>Session 1</b> · Motion paths for sprites, guide video as reference (code v1)
</td>
<td align="center" width="50%">
<a href="https://youtu.be/R8GCUxKfZFQ"><img src="https://img.youtube.com/vi/R8GCUxKfZFQ/hqdefault.jpg" width="360" alt="Session 2: Camera path (code v2)"></a><br>
<b>Session 2</b> · Camera path (code v2)
</td>
</tr>
<tr>
<td align="center" width="50%">
<a href="https://youtu.be/vrDhuli4wA0"><img src="https://img.youtube.com/vi/vrDhuli4wA0/hqdefault.jpg" width="360" alt="Session 3: Motion path over a generated background (code v2)"></a><br>
<b>Session 3</b> · Motion path over a generated background (code v2)
</td>
<td align="center" width="50%">
<a href="https://youtu.be/EJDNtuhjN4E"><img src="https://img.youtube.com/vi/EJDNtuhjN4E/hqdefault.jpg" width="360" alt="Session 4: 3D perspective, bat in a dark forest (code v3)"></a><br>
<b>Session 4</b> · 3D perspective, bat in a dark forest (code v3)
</td>
</tr>
</table>

## Hackathon timeline

**Built at the hackathon.** Before Sept 30 the repo contained only the Next.js scaffold
(`create-next-app`), a generic Runway SDK starter from the Runway Dev quickstart (a
one-form text/image-to-video page, since replaced), installed agent skills, and design
notes. All DrawTalkRunway functionality — motion paths, layers, guide videos, motion
modifiers, camera paths, 3D perspective, background generation, Model Router
integration, progress, sharing — was written on Sept 30 between 9:30 and 16:00, in
PRs #1–#5. About **85% of the current code was written that day**; the rest is framework
boilerplate, configuration, and the generic SDK client and error-handling pattern.
Built with an AI coding assistant (Claude Code).

| When (PDT) | What |
|---|---|
| Sept 26 | Next.js scaffold, generic Runway SDK starter, agent skills, idea and logistics notes (`fdaa59f`–`5b2e542`) |
| Sept 30, 9:11 | Design notes only (`e0b347d`) |
| 9:53 | PR #1 — v0: drawn motion paths and layers → guide image → video |
| 12:01 | PR #2 — v1: guide video, sprites, motion modifiers, looser reference mode, progress |
| 12:42 | PR #3 — v2: camera paths, parallax, background generation |
| 14:25 | PR #4 — v3: 3D perspective (horizon, dolly camera, sprite depth), editor auto-save |
| 15:56 | PR #5 — v4: password-protected sharing, demo video in the README |

Exactly what changed on the day:
https://github.com/1iyiwei/runway-hackathon/compare/5b2e542...main

## Run the demo

Requirements: Node.js 20+, [ffmpeg](https://ffmpeg.org) on the `PATH` (encodes the guide
video; `brew install ffmpeg`), and a Runway Dev API key (https://dev.runway.com).

1. Install dependencies (first time only):

   ```bash
   npm install
   ```

2. Add your API key (first time only). Copy the example file, then paste the key after
   `RUNWAYML_API_SECRET=` in `.env.local`:

   ```bash
   cp .env.local.example .env.local
   ```

3. Start the app, then open http://localhost:3000:

   ```bash
   npm run dev
   ```

   For a faster, more stable demo, use a production build instead:

   ```bash
   npm run build && npm start
   ```

   To use another port, e.g. when 3000 is taken: `npm run dev -- -p 3001`.

The app routes generations through two Model Router configs that must exist in the
Developer Portal (**Model Routers**): `drawtalk-preview` (optimize for latency) and
`drawtalk-final` (optimize for quality). The IDs are set in `src/lib/runway.ts`.

## Sharing the demo

To share a running instance (e.g. through `ngrok http 3000`), set in `.env.local`:
`DEMO_PASSWORD` (every page and API then requires a login, username `DEMO_USER`,
default `judge`) and optionally `DEMO_READ_ONLY=1` (disables Generate / Generate
background so visitors can't spend your credits; drawing, preview, Check route and the
saved runs still work). Use a production build (`npm run build && npm start`).

## Using it

1. Optionally load a background image (**Load background**); otherwise you draw on white.
2. Select a motion layer, give it a description ("a butterfly flying"), pick a color, and
   draw its path on the canvas. The start dot and arrowhead are added automatically.
   **+ Layer** adds another subject/path.
   In **Guide video** mode (the default), each layer also has a stand-in sprite (emoji),
   size, orientation (follow the path or upright), the direction the sprite faces in its
   image, and motion modifiers (**flap** Hz, **bob** px, **wobble** °) with per-sprite
   defaults; **Sprite timing** sets the
   speed along the path (ease in/out, constant, or your drawing speed).
   **Preview motion** plays the animation on the canvas.
   **+ Camera** adds a camera layer: draw where the center of the view travels, and set
   the zoom at start and end (e.g. 1.5× → 2× pushes in). The camera has its own timing,
   ease in/out by default, so moves start and stop smoothly.
   **3D perspective** (Canvas panel) adds a ground plane with a **horizon** line (drag the
   slider to match the background): sprites shrink as their paths approach the horizon,
   and the camera path becomes a **dolly** — drawing up toward the horizon moves the
   camera forward into the scene, drawing sideways trucks it. In guide-video modes the editor
   outlines the camera's start (solid) and end (dashed) views, and each motion layer gets
   a **parallax** slider (1 = moves with the background, >1 = closer to the camera).
3. Edit the scene description. The prompt is generated from the scene and the layers; you
   can override it.
4. Choose the conditioning mode and router (Preview / Final), then **Check route (free)**
   to see which model would run and its estimated cost, or **Generate**.

Conditioning modes:
- **Guide video** — sprites move along the paths; the video (`guide.mp4`) is the source of
  a video-to-video restyle, so the path is specified in every frame.
- **Guide video as reference** — the same guide video as a *reference* video (plus the
  clean background as the first frame, if any): looser, so the model animates more freely.
- **Guide image as first frame / as reference / clean background + reference** — the
  flattened path drawing conditions an image-to-video model (v0).

Defaults: 4 s duration (fastest); sprite timing = your drawing speed; camera timing =
ease in/out.

Reloading the page is safe: generation continues on the server, and the page restores
its run list from `runs/` (runs still generating update every 10 s).

Each run is saved under `runs/<run-id>/` (git-ignored): `guide.png`, `guide.mp4` (video
mode), `request.json`
(prompt, router input, stroke data, routing decision), `task.json`, and `output.mp4`.
Saved outputs are served at `/api/runs/<run-id>/output.mp4`, so they keep working
after Runway's output URLs expire (24–48h) and double as demo backups.

## How it works

**Idea.** DrawTalkRunway (after the author's earlier work on motion brushes and draw-and-talk
animation) lets you *direct* a video by drawing: each motion layer is a path + a subject
+ a description of how it moves. Runway's video models have no motion-path, camera-path
or mask parameters, so DrawTalkRunway turns the drawing into something they *do* accept.

**Pipeline** — "guide, then stylize":

```
draw paths (layers) + describe  ──►  guide  ──►  Model Router  ──►  video model  ──►  output
                                      │           (dry run: model + cost, free)
                                      ├─ guide image: paths + start dots + arrows (v0)
                                      └─ guide video: stand-in sprites moving along the paths (v1)
```

1. **Spatial (deterministic, in the browser).** Each stroke is recorded with timestamps,
   parameterized by arc length, and replayed with a timing curve (your drawing speed,
   constant, or ease in/out). A sprite is posed at each frame: position on the path and
   orientation from the path tangent. Each sprite has a native heading, so every sprite
   faces its direction of travel; side views (bee, bird, fish) mirror instead of flying
   upside down. **Motion modifiers** add secondary motion to the guide itself — flap
   (a squash across the wing axis, perpendicular to the sprite's heading), bob (offset
   along the path normal) and wobble (rotation jitter) — with a per-layer phase so layers
   don't move in sync. A **camera layer** turns a drawn path into a camera move: each
   frame is a view of the background centered on the path point, zoomed between the
   start and end zoom and kept inside the image (so panning never shows an edge); motion
   layers get **multiplane parallax** (a layer with parallax p moves p times as much as
   the background). The camera move is also described in the prompt ("the camera
   smoothly pans right, tilts down and pushes in"). **3D perspective** models a ground
   plane: a point's distance below the horizon is inversely proportional to its depth,
   so sprite size scales with it, and a dolly camera is approximated by scaling the view
   about the vanishing point above the camera (up the frame = forward). Frames are rendered one by one (not screen-recorded, so tab throttling
   can't drop frames) and encoded server-side by ffmpeg into an exact 24 fps H.264 MP4.
2. **Semantic (prompt).** The prompt is generated per mode from the scene description
   and each layer's subject and *motion details* (secondary motion such as "wings
   flapping fast"), and states that guide marks never appear in the output video.
3. **Generation (Runway).** Everything goes through **Model Routers** — never a
   hard-coded model: `drawtalk-preview` (optimize for latency) and `drawtalk-final`
   (quality). The router's model-agnostic input maps directly onto DrawTalkRunway's
   conditioning modes (`referenceImages` role `first` / `reference`, `referenceVideos`
   role `source` / `reference`), and excludes models that can't take that input. A free
   **dry run** shows which model would run and the estimated cost before spending
   credits. Media goes up as ephemeral uploads; every run (inputs, request, routing
   decision, output) is saved locally.

**Runway Dev features used:** Model Router (2 configs, routed `generate.video`, HTTP dry
run), ephemeral uploads, image-to-video and video-to-video conditioning via the router,
task polling with the SDK's `waitForTaskOutput`; Runway Dev agent skills during
development (Dev MCP connected for account access).

**What we learned (conditioning modes):**

| Mode | Routed to | Path accuracy | Secondary motion | Guide marks in output |
|---|---|---|---|---|
| Guide image as first frame | `veo3.1_fast` / `veo3.1` | rough | natural | path can persist / morph |
| Guide image as reference | `seedance2_fast` / `seedance2_5` | loose | natural | path lines leak in |
| Guide video (source) | `seedance2_fast` / `seedance2_5` | accurate | rigid (copies the icons) | none |
| Guide video as reference | `seedance2_fast` / `seedance2_5` | good | still rigid | none |
| Guide video as reference + motion modifiers | `seedance2_fast` / `seedance2_5` | good | natural (bee) | none |

The trade-off: the stronger the spatial conditioning, the more literally the model
copies the guide — including its stiff motion — so DrawTalkRunway puts secondary motion into
the guide itself (motion modifiers). Next steps: upload your own sprites, outpainting
for wider camera moves, and LLM/VLM agents for the planning and semantic roles (see
[draw-talk.md](draw-talk.md)).

**Stack:** Next.js 16 (App Router, TypeScript), HTML canvas, `@runwayml/sdk`, ffmpeg.

## Code map

- `src/app/page.tsx`: editor UI (canvas, layers, prompt, runs).
- `src/lib/scene.ts`: scene model, path drawing / flattening, prompt templates.
- `src/lib/guide-video.ts`: path tracks (arc length, timing), sprite poses, deterministic
  guide-frame rendering and the live preview.
- `src/app/api/plan/route.ts`: encodes guide frames into `guide.mp4` (ffmpeg), uploads
  the guide media, dry-runs the router (free), and saves the request as a run.
- `src/app/api/generate/route.ts`: runs a saved request via `client.generate.video` and
  saves the output and a `status.json`.
- `src/app/api/runs/`: lists saved runs (restored after a reload) and serves run files.
- `src/lib/runway.ts`: server-only Runway client, router config IDs, and dry-run helper.
  `RUNWAYML_API_SECRET` never reaches the browser.
- `.agents/skills/runway-dev*`: Runway Dev agent skills.

## Notes

- Model request fields and router eligibility change over time; see
  https://docs.dev.runwayml.com/api.md.
- Costs: https://docs.dev.runwayml.com/guides/pricing.md
- A negative prompt limits routing to models that support it (currently Veo).
