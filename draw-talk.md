
# DrawTalk Gen-AI

Many ideas discussed with [Google Gemini](https://share.google/aimode/Sheo0IOKbmQ8dCCKm).
Ultimately, I want to do the following.

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
2. The Spatial Agent (NVIDIA/Compute Focused): Takes the drawing stroke vectors and bounding boxes. It maps the geometry into explicit Runway spatial conditioning parameters, camera moves, and mask boundaries.
3. The Semantic Agent (LLM/Context Focused): Translates the narrative blocks ("hair flowing", "walking briskly") into descriptive prompt enhancements that optimize Runway's cinematic outputs.

## Implementation

### Multi-scene, Dynamic Camera 3D Animations
* The Strength: This targets the exact competitive edge of models like Runway Gen-3 or World Models, which have a strong internal understanding of 3D parallax and spatial geometry.
* The Hackathon Strategy: Because Runway's API uses parameters for camera paths (zoom, pan, roll), the multi-modal system shouldn't try to build a 3D engine from scratch. Instead, have the user sketch a 2D line on the canvas. If they draw a spiral, the system translates that trajectory into an active camera tracking payload for Runway's backend.

### Multiple Overlapping Motion Paths. This is the most innovative interaction question. For a 6-hour hackathon, parsing complex multi-stroke sketches simultaneously introduces a high probability of user intent collision and debugging nightmares.
* The Better UX Approach: Separate interaction layers.
* Why: Think of it like traditional animation cels. The user taps the character to draw the "Body Path" (e.g., walking forward), then switches layers or selects a different semantic brush to draw the secondary "Hair Path" (e.g., wind blowing). This makes it highly intuitive for a live frontend demo and gives the multi-agent backend clean, isolated variables to process rather than a tangled web of overlapping vector paths.
