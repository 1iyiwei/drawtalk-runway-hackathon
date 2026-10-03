# DrawTalkRunway — Runway Hackathon submission (Sept 30, 2026)

- **Demo video (3 min):** https://youtu.be/n5Zx8ZG9J1Y
- **Code:** https://github.com/1iyiwei/drawtalk-runway-hackathon
- **Live demo:** https://transform-evolve-sector.ngrok-free.dev (temporary, password-protected; login shared separately)

## One-liner

DrawTalkRunway: direct AI video by drawing. Sketch motion paths for subjects and the camera, and Runway renders a video that follows them.

## Short description

DrawTalkRunway turns drawn motion paths into Runway video. Draw where a butterfly flies, where a bee lands, or how the camera dollies into a forest, and it renders a guide animation that Runway's Model Router sends to the best video model to restyle into a real scene.

## Description

Describing motion in words is hard: "the bee lands on the second rose, then flies off to the left" rarely comes out right. DrawTalkRunway lets you draw it instead. You sketch motion paths for subjects (sprites with procedural flapping, bobbing and wobble) and for the camera (pan, zoom, or a 3D dolly with a ground-plane horizon). The app renders a deterministic guide video and a prompt from your drawing, then Runway's Model Router picks a model that can take the guide and restyle it into a real, naturally animated scene. It builds on my earlier work on the Adobe Fresco motion path and draw-and-talk animation. Built with Next.js, the Runway SDK, and Model Routers for video and backgrounds.

## How we used Runway Dev

**As submitted:** DrawTalkRunway runs everything through Runway's Model Router, with two configs: preview (latency) and final (quality). Our drawn motion paths become a guide image or a rendered guide video, and these map directly onto the router's model-agnostic inputs: `referenceImages` (first frame or reference) and `referenceVideos` (source for video-to-video, or reference). The router only picks models that accept that input; it chose Veo 3.1 and Seedance 2 variants. A free router dry run shows the model and cost before generating, and background images come from the same routers. We use ephemeral uploads, the SDK's task waiting plus progress polling, and local saving of outputs. We built it with the Runway Dev quickstart, docs and agent skills.

**Details:**

- **Model Router for every generation.** No hard-coded models. Two router configs: `drawtalk-preview` (optimized for latency) and `drawtalk-final` (quality). All video goes through `client.generate.video` with model-agnostic inputs that map directly onto our conditioning modes: drawn-path images as `referenceImages` (role `first` or `reference`), and our rendered guide videos as `referenceVideos` (role `source` for video-to-video, or `reference` for looser motion). The router only considers models that accept those inputs; during the hackathon it picked `veo3.1_fast`, `veo3.1`, `seedance2_fast` and `seedance2_5`.
- **Free router dry runs.** A "Check route" button shows which model would run and its estimated cost before any credits are spent.
- **Background images** are generated from a prompt through the same routers (`client.generate.image`, 1k for preview, 2k for final).
- **Ephemeral uploads** send guide images and the guide videos we encode with ffmpeg.
- **Task lifecycle:** the SDK's `waitForTaskOutput`, plus `tasks.retrieve` polling for live progress bars; `TaskFailedError` handling; and outputs downloaded locally, since Runway's output links expire.
- **Development:** built from the Runway Dev quickstart, the LLM-friendly docs (`llms.txt`, `api.md`) and the Runway Dev agent skills, with the Dev MCP connected for account access.

## Hackathon timeline

Everything was built on Sept 30 apart from a generic pre-event scaffold; see the
[Hackathon timeline](README.md#hackathon-timeline) in the README for details.

## What we learned

The stronger the spatial conditioning, the more literally the model copies the guide, including its stiff motion. Drawn paths as images give natural motion but loose paths; a guide video as the source gives accurate paths but rigid motion. The best balance was the guide video as a *reference* plus secondary motion (flap, bob, wobble) drawn into the guide itself. See the findings table in the [README](README.md#how-it-works).
