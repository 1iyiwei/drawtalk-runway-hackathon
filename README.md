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
- **Guide image as first frame / as reference / clean background + reference** — the
  flattened path drawing conditions an image-to-video model (v0).

Each run is saved under `runs/<run-id>/` (git-ignored): `guide.png`, `guide.mp4` (video
mode), `request.json`
(prompt, router input, stroke data, routing decision), `task.json`, and `output.mp4`.
Saved outputs are served at `/api/runs/<run-id>/output.mp4`, so they keep working
after Runway's output URLs expire (24–48h) and double as demo backups.

## Code map

- `src/app/page.tsx`: editor UI (canvas, layers, prompt, runs).
- `src/lib/scene.ts`: scene model, path drawing / flattening, prompt templates.
- `src/lib/guide-video.ts`: path tracks (arc length, timing), sprite poses, deterministic
  guide-frame rendering and the live preview.
- `src/app/api/plan/route.ts`: encodes guide frames into `guide.mp4` (ffmpeg), uploads
  the guide media, dry-runs the router (free), and saves the request as a run.
- `src/app/api/generate/route.ts`: runs a saved request via `client.generate.video` and
  saves the output.
- `src/lib/runway.ts`: server-only Runway client, router config IDs, and dry-run helper.
  `RUNWAYML_API_SECRET` never reaches the browser.
- `.agents/skills/runway-dev*`: Runway Dev agent skills.

## Notes

- Model request fields and router eligibility change over time; see
  https://docs.dev.runwayml.com/api.md.
- Costs: https://docs.dev.runwayml.com/guides/pricing.md
- A negative prompt limits routing to models that support it (currently Veo).
