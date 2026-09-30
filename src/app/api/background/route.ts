import { TaskFailedError } from "@runwayml/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKGROUNDS_DIR, JOB_ID_RE, JOBS_DIR } from "@/lib/backgrounds";
import { getRunway, ROUTER_CONFIGS, type Quality } from "@/lib/runway";

// Image generation takes seconds to a minute.
export const maxDuration = 300;



// Keep the plate empty: the motion layers supply the subjects.
const PLATE_SUFFIX =
  "Background plate only: an empty scene with no people, animals, insects or text, with room for subjects to move through it.";

type BackgroundRequest = {
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  quality: Quality;
  emptyPlate?: boolean; // default true
  jobId?: string; // client-chosen id for progress polling (GET /api/background/progress)
};

// POST — generate a background image through the Model Router and return it as a
// data URL (same-origin, so the canvas can use it), saving a copy in backgrounds/.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as BackgroundRequest | null;
  const configId = body && ROUTER_CONFIGS[body.quality];
  if (!body?.prompt?.trim() || !configId) {
    return Response.json({ error: "Missing prompt or unknown quality." }, { status: 400 });
  }
  const promptText = body.emptyPlate === false ? body.prompt.trim() : `${body.prompt.trim()} ${PLATE_SUFFIX}`;

  try {
    const client = getRunway();
    const pending = client.generate.image.create({
      configId,
      input: {
        promptText,
        aspectRatio: body.aspectRatio,
        resolution: body.quality === "final" ? "2k" : "1k", // 2k leaves detail for camera zoom
      },
    });
    let routing: { model?: string; estimatedCost?: { credits: number } } | undefined;
    pending
      .then(async (r) => {
        routing = r.routing;
        if (body.jobId && JOB_ID_RE.test(body.jobId)) {
          await mkdir(JOBS_DIR, { recursive: true });
          await writeFile(path.join(JOBS_DIR, `${body.jobId}.json`), JSON.stringify({ taskId: r.id }));
        }
      })
      .catch(() => {});
    const task = await pending.waitForTaskOutput();

    const url = task.output?.[0];
    if (!url) throw new Error("No image returned.");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
    const type = res.headers.get("content-type")?.split(";")[0] || "image/png";
    const buf = Buffer.from(await res.arrayBuffer());

    const ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    await mkdir(BACKGROUNDS_DIR, { recursive: true });
    await writeFile(path.join(BACKGROUNDS_DIR, name), buf);
    await writeFile(
      path.join(BACKGROUNDS_DIR, `${name}.json`),
      JSON.stringify({ configId, promptText, routing, taskId: task.id }, null, 2),
    );

    return Response.json({
      dataUrl: `data:${type};base64,${buf.toString("base64")}`,
      model: routing?.model,
      credits: routing?.estimatedCost?.credits,
      file: `backgrounds/${name}`,
    });
  } catch (error) {
    if (error instanceof TaskFailedError) {
      const d = error.taskDetails;
      const message = d.status === "FAILED" ? (d.failure ?? "Generation failed.") : `Generation ${d.status.toLowerCase()}.`;
      return Response.json({ error: message }, { status: 422 });
    }
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
