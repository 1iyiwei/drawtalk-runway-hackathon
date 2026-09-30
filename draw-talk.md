
# DrawTalk Gen-AI

Use multi-modal inputs, including direct manipulation, motion paths, natural languages, and drawings to animate a static image, either imported or manually drawn.

One aspect I like about this idea is that it connects to my previous works on (1) Adobe Fresco motion brush which can create animations from drawings and (2) DIS paper on narrative motion blocks and UIST paper on draw-talking which combine natural languages and drawings to create animations.

Beyond single-scene, static camera 2D animations of these prior works, there are two extensions that I want to explore with respect to the Runway model capabilities:
1. Multi-scene, dynamic camera 3D animations. This is a more complex scenario but still uses the same set of multi-modal inputs.
2. Multiple overlapping motion paths. For example, if a user wants a character to walk along one path while their hair flows along another, should they create separate interaction layers, or should the system attempt to parse complex multi-stroke sketches simultaneously?

## Architecture
Architecture-wise I would like to use a multi-deep-agent system like LangChain.

Using an agentic pipeline is a strong technical narrative for the AWS and NVIDIA judges. To prevent infrastructure bloat, the multi-agent architecture can be elegantly streamlined into three specialized roles:

                  ┌──────────────────────┐
                  │  1. Planner Agent    │ <── Multi-modal Intake
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
   ┌────────────────────┐        ┌────────────────────┐
   │ 2. Spatial Agent   │        │ 3. Semantic Agent  │
   │ (Paths/Masks/Cams) │        │  (Physics/Style)   │
   └──────────┬─────────┘        └──────────┬─────────┘
              │                             │
              └──────────────┬──────────────┘
                             ▼
                  ┌──────────────────────┐
                  │  Runway API Executor │
                  └──────────────────────┘


1. The Planner Agent: Ingests the baseline image, the raw text transcript, and the selected layers. It acts as the orchestrator to decide how many shots or steps are needed.
2. The Spatial Agent (NVIDIA/Compute Focused): Takes the drawing stroke vectors, sprites, and bounding boxes. Since Runway has no spatial conditioning parameters (see [Spatial Agent Design](#spatial-agent-design)), it renders the geometry into a deterministic guide video / keyframes that the stylization model is conditioned on.
3. The Semantic Agent (LLM/Context Focused): Translates the narrative blocks ("hair flowing", "walking briskly") into descriptive prompt enhancements that optimize Runway's cinematic outputs.

## Implementation

### Multi-scene, Dynamic Camera 3D Animations
* The Strength: This targets the exact competitive edge of video models like Runway Gen-4.5 / Aleph 2 or World Models, which have a strong internal understanding of 3D parallax and spatial geometry.
* The Hackathon Strategy: Runway's API has *no* camera-path parameters (zoom, pan, roll), and we shouldn't build a 3D engine from scratch either. Instead, have the user sketch a 2D line on the canvas; the Spatial Agent turns it into a 2.5D multiplane camera move (per-layer parallax) in the guide video, and the stylization model adds the real 3D look. See [Camera paths](#camera-paths-v2).

### Multiple Overlapping Motion Paths. This is the most innovative interaction question. For a 6-hour hackathon, parsing complex multi-stroke sketches simultaneously introduces a high probability of user intent collision and debugging nightmares.
* The Better UX Approach: Separate interaction layers.
* Why: Think of it like traditional animation cels. The user taps the character to draw the "Body Path" (e.g., walking forward), then switches layers or selects a different semantic brush to draw the secondary "Hair Path" (e.g., wind blowing). This makes it highly intuitive for a live frontend demo and gives the multi-agent backend clean, isolated variables to process rather than a tangled web of overlapping vector paths.

## Spatial Agent Design

Implementation guideline for the Spatial Agent. Principle: **guide, then stylize** — turn the multi-modal inputs into a deterministic guide (where things are and how they move: primary motion), then let a Runway video model stylize it (how it looks: style, lighting, secondary motion from the Semantic Agent's prompt).

```
per layer:  sprite(s) + path + keys ──► [Sprite Animation Tool] ──► RGBA frames + track
                     ▲                         (deterministic)
       Spatial Agent (VLM) picks keys
                                     all layers ──► composite (back-to-front) ──► guide frames
                                                                                    │
                        stylization profile (option panel) selects what to export ◄─┘
                                                                                    ▼
                                                      Runway stylization (+ Semantic prompt)
```

### Runway conditioning capabilities

As of 2026-09-26 from https://docs.dev.runwayml.com/api.md — **re-check on the day**. There are no camera / motion-path / mask parameters, and generated video has no alpha (ProRes 4444 alpha is fully opaque), so all compositing happens before stylization (or after it, in the overlay fallback).

| Profile | Models (examples) | What the guide contributes |
|---|---|---|
| First frame | `gen4.5` image_to_video | frame 0 only; the path survives only as prompt text |
| First + last frame | `veo3.1`, `seedance2*`, `hailuo3` image_to_video | frames 0 and N-1; the in-between path is up to the model |
| Full guide video | `seedance2` (`promptVideo`, ≤15 s), `aleph2` (`videoUri`, ≤30 s) video_to_video | every frame — path fully specified |
| Full video + timed keyframes | `aleph2` (`keyframes`, ≤5, at `seconds` / `at`) | every frame + up to 5 appearance guides at chosen times |
| Identity references | `seedance2*` (`references`, ≤9 images) | the sprite image(s) for identity, not timing; combinable with the above |

Duration and ratio limits are per model; the profile also fixes the frame count N (duration × fps) and output size.

### Sprite Animation Tool (deterministic)

A pure function, no model calls — the same inputs always give the same frames:

```
renderSpriteLayer({
  sprite,       // one RGBA image, or a frame cycle (flipbook, e.g. 2-3 wing poses) + cycle rate
  path,         // drawn stroke: points (+ optional timestamps)
  keys,         // [{ s, transform }] — transforms at specific path points, s in [0,1]
  timing,       // frame -> path fraction s (ease curve, or the stroke's own timestamps)
  window,       // active frame range of this layer within the global N frames
  N, size,      // global frame count and frame size (shared by all layers)
}) -> { frames: RGBA[N], track: per-frame { corners[4], center, angle, spriteFrame } }
```

* **Path**: smooth the stroke (e.g. Catmull-Rom) and parameterize by arc length, so `s` means "fraction of distance along the path", independent of how unevenly the points were sampled.
* **Timing is separate from shape**: frames are sampled in time, keys live on the path, and `timing` maps one to the other. Default: the stroke's own drawing speed (draw fast → move fast, a performance-driven feel like motion brush); alternatives: constant speed, ease in/out.
* **Keys are relative to the path's local frame** (tangent/normal): "follow the path" is the default, and a key only stores the deviation from it.
* **Interpolate parameters, not matrices**: lerping matrices shrinks and skews mid-rotation. Interpolate the key parameters (angle along the shortest arc, scale in log space), then build the matrix per frame inside `renderSpriteLayer`.

#### Transform parameters

A 2D transform of the sprite's bounding box has a fixed number of degrees of freedom (DOF); the parameters must cover them exactly once:

| Transform | DOF | Parameters |
|---|---|---|
| Similarity | 4 | position (2, **from the path**), rotation, uniform scale |
| Affine | 6 | + non-uniform scale (scaleX ≠ scaleY), shear |
| Homography (perspective) | 8 | + 2 perspective DOF |

* **Position** comes from the path at `s` (plus an optional offset along the path normal), so keys never store it.
* **Flip** is not an extra DOF: it's a negative scaleX, i.e. a mirror.
* **Corners** = displacements of the bounding box's 4 corners (2×2 control points, 8 numbers). They define a homography *directly* and are an alternative to the list above, not an addition. If used, apply them only as a residual on top of the parametric transform, otherwise the parameters over-determine the matrix. Main use: a perspective tilt (fake 3D).
* **Composition order must be fixed**, because matrices don't commute:
  `M = T(pathPos + normalOffset) · R(pathAngle·follow + rotation) · Shear · S(flip·scaleX, scaleY) · T(−anchor)`
  `anchor` is the pivot in sprite coordinates (butterfly body center, a character's feet); rotation and scale happen about it.

**v1: rotation + scale only** (a similarity transform), plus:
* **flip**: otherwise a side-view sprite that follows a path heading left ends up upside down. v1 orientation modes: `follow` (rotate with the tangent), `upright` (no rotation; mirror when moving left), `fixed`.
* optional **scaleX/scaleY** — only 1 extra parameter, and it is what enables squash & stretch (see [Motion style](#motion-style)). Worth including if the cartoon style is a goal.
* Later: shear, then corners for perspective.
* **Sprite frame cycle** is indexed by time, independent of keys (e.g. wing flap at 3 Hz). With a single image, a flap can be faked by squashing along the wing axis.
* **Outputs**: per-frame RGBA (for compositing and the overlay fallback) and a `track` JSON — ground truth for measuring path fidelity and identity preservation after stylization.

### Stylization profile (option panel)

The user picks the stylization model/profile on an option panel. Design choice: **always render all N frames; the profile only decides which frames are exported and how** (single image, image pair, full video, video + ≤5 keyframes). One render path serves every model, and switching models doesn't re-run the agent.

The number and placement of *keys* (what the user/agent specifies) are therefore independent of the model. What the profile changes:
* Sparse profiles (first / first+last) lose the in-between path. The agent should warn, or offer **segmenting**: split at keys into consecutive clips (key i → key i+1 as first/last frames), then concatenate. Costs one generation per segment, with a risk of seams.
* `aleph2` keyframes: choose up to 5 export times — default the user's keys, else points of high curvature or speed change.
* Profile constraints (duration range, ratios, max keyframes) set N, the frame size, and validation.

### Agent role (VLM)

The VLM *chooses parameters*; the tool does the geometry. The VLM never outputs matrices or pixels.

* **Input**: the motion prompt ("butterfly flutters up, loops, then lands on the flower"), the sprite image, the stroke (as numeric points *and* as an annotated picture, see below), the optional background image, the motion style, and the profile.
* **Output**: schema-validated JSON: the sprite's native heading (which way the butterfly faces in its image), anchor point, orientation mode, keys `[{ s, rotation, scale }]` (v1), timing, motion modifiers (below), and layer window. Clamp to sane ranges, then call the tool.

#### Path picture: context for the VLM

VLMs reason poorly about raw coordinate lists but well about pictures. The stroke is rendered as an image, over the background when there is one, so the VLM can:
* **relate the path to the scene**: the path ends on a flower → decelerate and settle; it dips toward the ground → a bounce or contact; it passes behind a tree → the layer order or scale changes.
* **infer depth**: a path heading toward the horizon → scale down.
* **refer to path positions precisely**: annotate the picture with start/end markers, a direction arrow, and **numbered ticks at s = 0.1, 0.2, …**, so the VLM can say "at s = 0.6, rotate −30°" rather than guessing coordinates. Without a background, still draw the path on a blank canvas with the same annotations.

#### Motion style

The Spatial Agent decides the **primary motion style**, e.g. realistic (a real butterfly's erratic flutter) vs. Disney-style (arcs, anticipation, ease in/out, squash & stretch, overshoot, follow-through). Style lives mostly in **timing** (easing, holds, speed changes), not only in key poses, so the VLM controls timing too.

* **Motion modifiers** (deterministic, parameterized, applied on top of path + keys) are more robust than asking the VLM to write many keys: `bob` (normal offset sine), `wobble` (rotation jitter), `bank` (rotation ∝ curvature), `squashStretch` (scaleX/scaleY ∝ speed or acceleration), `overshoot` (settle at stops), `anticipation` (small reverse move before a start). The VLM picks modifiers and amplitudes; a few keys handle the specific moments.
* **Few-shot examples in the system prompt**: yes. A small library, say 3–5 worked examples each for *realistic* and *cartoon*: input (prompt + annotated path summary + sprite type) → output JSON. Benefits: a consistent schema, safer with weaker VLMs, and the same examples double as a test set. The VLM may still improvise beyond them.
* **One style choice, shared**: style is picked once (user option or Planner) and passed to both the Spatial Agent (motion) and the Semantic Agent (prompt: "hand-drawn cartoon, Disney-style" vs. "photoreal nature footage"), so the stylization model doesn't fight the guide's motion.
* **Optional check loop** (time permitting): render a contact sheet of the guide frames, have the VLM compare it with the intent, and adjust the keys once. A small self-critique loop; good agentic narrative.
* The VLM could be Claude on AWS Bedrock (image input) for the AWS angle.

### Intermediate image steps (optional)

* **Clean plate**: when the sprite is cut out of the source image ("animate this static picture"), the background has a hole where the sprite was. Inpaint it once with an image model before animating — check on the day which `text_to_image` models support editing with a reference image.
* **Outpaint**: camera moves or transforms that expose empty regions (v2).

### Layers & compositing

* Global `N`, fps, size for all layers (so one profile applies globally); each layer has an active window and a depth.
* Composite back-to-front with premultiplied alpha ("over").
* Keep per-layer RGBA frames as well as the flattened guide, which enables the **overlay fallback**: stylize without the sprites, then composite the original sprites on top (+ an optional light `aleph2` harmonize pass) if stylization doesn't preserve sprite identity.
* Secondary motion (hair, wings, cloth) goes to the Semantic Agent as prompt text rather than into the guide.

### Camera paths (v2)

Camera path on a background layer: pan / zoom / roll as a transform applied inversely to every layer, with multiplane parallax — a layer at depth `d` moves by `1/d` of the camera pan (and zoom `1 + (z-1)/d`). It is the same tool with a camera transform composed onto each layer's transform.

### v0: drawn-path prototype (build first)

The minimal test: no sprites, no renderer. It checks whether video models follow a path drawn *into* the conditioning image.

* **UI**: pick a brush color, draw a motion path on a blank canvas or over a loaded background image, type a description ("a butterfly flies along this black path in a beautiful garden"), choose a model, generate.
* **Flatten**: background + stroke → one image at the model's ratio (e.g. 1280×720, so there's no auto-crop), with an automatic **start dot + arrowhead** for direction.
* **Prompt**: auto-insert the color phrase ("the black path, starting at the dot, following the arrow") and a removal instruction ("the line is only a motion guide and never appears in the video"). Warn when the brush color has low contrast with the background.
* **Models to compare**: `gen4.5` / `veo3.1` with the image as the first frame; `seedance2` with it as a reference image (clean background + annotated path; references can't be mixed with first/last-frame mode).
* **Save the stroke points** too: they feed the v1 sprite renderer and path-fidelity checks.
* **Runway-only**: flattening and prompt templating are deterministic, so v0 needs no outside LLM/VLM — just the Runway key and credits. (Runway's API has no general-purpose text/vision reasoning model, so the v1 agents need an outside model such as Claude on AWS Bedrock, or UI menus replace the VLM. Confirm at kickoff that outside models are OK.)
* **What we learn**: does the model follow the path, and does the line disappear? If yes → a baseline demo within the first hour. If not → motivation for the guide-video pipeline (v1).

### v1 scope

1. One foreground sprite (single image or frame cycle) over one static background image, one drawn path.
2. VLM-chosen keys (rotation + scale, flip via orientation mode) + motion modifiers + timing → Sprite Animation Tool → guide video + track. Two styles: realistic and cartoon, with few-shot examples.
3. Profiles: full guide video (`aleph2` / `seedance2`) and first+last frame.
4. First experiment: identity preservation of the sprite under stylization, with / without identity references.
