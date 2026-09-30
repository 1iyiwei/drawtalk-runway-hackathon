import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { toFile } from "@runwayml/sdk";
import { dryRunVideo, getRunway, ROUTER_CONFIGS, type RouterVideoInput } from "@/lib/runway";
import { newRunId, parseDataUrl, runPath, writeRunFile } from "@/lib/runs";
import type { PlanRequest, SavedRequest } from "@/lib/api-types";

const run = promisify(execFile);

// Encode the guide frames (00001.jpg, ...) into a constant-frame-rate H.264 MP4.
async function encodeFrames(runId: string, frames: File[], fps: number): Promise<string> {
  const dir = path.join(runPath(runId), "frames");
  await mkdir(dir, { recursive: true });
  await Promise.all(
    frames.map(async (f, i) =>
      writeFile(path.join(dir, `${String(i + 1).padStart(5, "0")}.jpg`), Buffer.from(await f.arrayBuffer())),
    ),
  );
  await run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-framerate", String(fps),
    "-i", path.join(dir, "%05d.jpg"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
    "-movflags", "+faststart",
    runPath(runId, "guide.mp4"),
  ]);
  await rm(dir, { recursive: true, force: true });
  return "guide.mp4";
}

async function readBody(request: Request): Promise<{ body: PlanRequest; frames: File[]; fps: number }> {
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await request.formData();
    const body = JSON.parse(String(form.get("payload"))) as PlanRequest;
    const frames = form.getAll("frames").filter((f): f is File => f instanceof File);
    const fps = Number(form.get("fps") ?? 24);
    return { body, frames, fps };
  }
  return { body: (await request.json()) as PlanRequest, frames: [], fps: 24 };
}

// Upload the guide media, dry-run the router (free), and save the request as a run.
// POST /api/generate then runs exactly this saved request.
export async function POST(request: Request) {
  let body: PlanRequest;
  let frames: File[];
  let fps: number;
  try {
    ({ body, frames, fps } = await readBody(request));
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const configId = ROUTER_CONFIGS[body.quality];
  if (!configId) return Response.json({ error: "Unknown quality." }, { status: 400 });
  if (!["first", "reference", "clean-first", "video"].includes(body.mode)) {
    return Response.json({ error: "Unknown mode." }, { status: 400 });
  }
  if (!body.prompt?.trim()) return Response.json({ error: "Prompt is empty." }, { status: 400 });
  if (body.mode === "clean-first" && !body.clean) {
    return Response.json({ error: "clean-first mode needs a background." }, { status: 400 });
  }
  if (body.mode === "video" && (frames.length < 2 || frames.length > 30 * 30)) {
    return Response.json({ error: "video mode needs 2-900 guide frames." }, { status: 400 });
  }
  if (!(fps > 0 && fps <= 30)) return Response.json({ error: "fps must be 1-30." }, { status: 400 });

  const runId = newRunId();
  try {
    const client = getRunway();
    const uploadFile = async (name: string, type: string) => {
      const buf = await readFile(runPath(runId, name));
      const { uri } = await client.uploads.createEphemeral({
        file: await toFile(buf, name, { type }),
      });
      return uri;
    };
    const saveAndUpload = async (dataUrl: string, name: string) => {
      const { buf, type } = parseDataUrl(dataUrl);
      await writeRunFile(runId, name, buf);
      return uploadFile(name, type);
    };

    const guideUri = await saveAndUpload(body.guide, "guide.png");

    const input: RouterVideoInput = {
      promptText: body.prompt,
      negativePrompt: body.negativePrompt || undefined,
      aspectRatio: body.aspectRatio,
      audio: false, // saves credits; guide test doesn't need sound
    };

    if (body.mode === "video") {
      const name = await encodeFrames(runId, frames, fps);
      const videoUri = await uploadFile(name, "video/mp4");
      // Video-to-video: output length follows the source video, so no duration.
      input.referenceVideos = [{ uri: videoUri, role: "source" }];
    } else {
      const cleanUri =
        body.mode === "clean-first" && body.clean
          ? await saveAndUpload(body.clean, "clean.png")
          : null;
      input.referenceImages =
        body.mode === "first"
          ? [{ uri: guideUri, role: "first" }]
          : body.mode === "reference"
            ? [{ uri: guideUri, role: "reference" }]
            : [
                { uri: cleanUri!, role: "first" },
                { uri: guideUri, role: "reference" },
              ];
      input.duration = body.duration;
    }

    const plan = { ...body, guide: undefined, clean: undefined };
    const saved: SavedRequest = { configId, input, plan: JSON.parse(JSON.stringify(plan)) };
    let routing: unknown;
    try {
      routing = (await dryRunVideo(configId, input)).routing;
    } catch (error) {
      await writeRunFile(runId, "request.json", JSON.stringify(saved, null, 2));
      return Response.json(
        {
          runId,
          error: error instanceof Error ? error.message : String(error),
          guideVideo: body.mode === "video" ? `/api/runs/${runId}/guide.mp4` : undefined,
        },
        { status: 422 },
      );
    }
    saved.routing = routing;
    await writeRunFile(runId, "request.json", JSON.stringify(saved, null, 2));
    const guideVideo = body.mode === "video" ? `/api/runs/${runId}/guide.mp4` : undefined;
    return Response.json({ runId, configId, routing, guideVideo });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ runId, error: message }, { status: 500 });
  }
}
