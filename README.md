# DrawTalk — Runway Hackathon (Sept 30, 2026)

Draw motion paths, describe the scene, and generate a video that follows them, using
[Runway Dev](https://docs.dev.runwayml.com) Model Routers. Built for the
[Runway Hackathon](https://hackathon.runway.com/). Design notes: [draw-talk.md](draw-talk.md).

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

## Using it

1. Optionally load a background image (**Load background**); otherwise you draw on white.
2. Select a motion layer, give it a description ("a butterfly flying"), pick a color, and
   draw its path on the canvas. The start dot and arrowhead are added automatically.
   **+ Layer** adds another subject/path.
   In **Guide video** mode (the default), each layer also has a stand-in sprite (emoji),
   size, orientation (upright or follow the path) and flip; **Motion timing** sets the
   speed along the path (ease in/out, constant, or your drawing speed).
   **Preview motion** plays the animation on the canvas.
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

Defaults: 4 s duration (fastest), motion timing = your drawing speed.

Reloading the page is safe: generation continues on the server, and the page restores
its run list from `runs/` (runs still generating update every 10 s).

Each run is saved under `runs/<run-id>/` (git-ignored): `guide.png`, `guide.mp4` (video
mode), `request.json`
(prompt, router input, stroke data, routing decision), `task.json`, and `output.mp4`.
Saved outputs are served at `/api/runs/<run-id>/output.mp4`, so they keep working
after Runway's output URLs expire (24–48h) and double as demo backups.

## How it works

**Idea.** DrawTalk (after the author's earlier work on motion brushes and draw-and-talk
animation) lets you *direct* a video by drawing: each motion layer is a path + a subject
+ a description of how it moves. Runway's video models have no motion-path, camera-path
or mask parameters, so DrawTalk turns the drawing into something they *do* accept.

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
   upside down. Frames are rendered one by one (not screen-recorded, so tab throttling
   can't drop frames) and encoded server-side by ffmpeg into an exact 24 fps H.264 MP4.
2. **Semantic (prompt).** The prompt is generated per mode from the scene description
   and each layer's subject and *motion details* (secondary motion such as "wings
   flapping fast"), and states that guide marks never appear in the output video.
3. **Generation (Runway).** Everything goes through **Model Routers** — never a
   hard-coded model: `drawtalk-preview` (optimize for latency) and `drawtalk-final`
   (quality). The router's model-agnostic input maps directly onto DrawTalk's
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
| Guide video as reference | `seedance2_fast` / `seedance2_5` | *(testing)* | *(testing)* | *(testing)* |

The trade-off: the stronger the spatial conditioning, the more literally the model
copies the guide — including its stiff motion. Next steps are to put life into the guide
itself (procedural flap / bob / bank modifiers), upload your own sprites, camera paths
with multiplane parallax, and LLM/VLM agents for the planning and semantic roles (see
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
