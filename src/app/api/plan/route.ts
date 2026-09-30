import { toFile } from "@runwayml/sdk";
import { dryRunVideo, getRunway, ROUTER_CONFIGS, type RouterVideoInput } from "@/lib/runway";
import { dataUrlToBuffer, newRunId, writeRunFile } from "@/lib/runs";
import type { PlanRequest, SavedRequest } from "@/lib/api-types";

// Upload the images, dry-run the router (free), and save the request as a run.
// POST /api/generate then runs exactly this saved request.
export async function POST(request: Request) {
  let body: PlanRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const configId = ROUTER_CONFIGS[body.quality];
  if (!configId) return Response.json({ error: "Unknown quality." }, { status: 400 });
  if (!["first", "reference", "clean-first"].includes(body.mode)) {
    return Response.json({ error: "Unknown mode." }, { status: 400 });
  }
  if (!body.prompt?.trim()) return Response.json({ error: "Prompt is empty." }, { status: 400 });
  if (body.mode === "clean-first" && !body.clean) {
    return Response.json({ error: "clean-first mode needs a background." }, { status: 400 });
  }

  const runId = newRunId();
  try {
    const client = getRunway();
    const upload = async (dataUrl: string, name: string) => {
      const buf = dataUrlToBuffer(dataUrl);
      await writeRunFile(runId, name, buf);
      const { uri } = await client.uploads.createEphemeral({
        file: await toFile(buf, name, { type: "image/png" }),
      });
      return uri;
    };

    const guideUri = await upload(body.guide, "guide.png");
    const cleanUri =
      body.mode === "clean-first" && body.clean ? await upload(body.clean, "clean.png") : null;

    const referenceImages: RouterVideoInput["referenceImages"] =
      body.mode === "first"
        ? [{ uri: guideUri, role: "first" }]
        : body.mode === "reference"
          ? [{ uri: guideUri, role: "reference" }]
          : [
              { uri: cleanUri!, role: "first" },
              { uri: guideUri, role: "reference" },
            ];

    const input: RouterVideoInput = {
      promptText: body.prompt,
      negativePrompt: body.negativePrompt || undefined,
      referenceImages,
      aspectRatio: body.aspectRatio,
      duration: body.duration,
      audio: false, // saves credits; guide test doesn't need sound
    };

    const plan = { ...body, guide: undefined, clean: undefined };
    const saved: SavedRequest = { configId, input, plan: JSON.parse(JSON.stringify(plan)) };
    let routing: unknown;
    try {
      routing = (await dryRunVideo(configId, input)).routing;
    } catch (error) {
      await writeRunFile(runId, "request.json", JSON.stringify(saved, null, 2));
      return Response.json(
        { runId, error: error instanceof Error ? error.message : String(error) },
        { status: 422 },
      );
    }
    saved.routing = routing;
    await writeRunFile(runId, "request.json", JSON.stringify(saved, null, 2));
    return Response.json({ runId, configId, routing });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ runId, error: message }, { status: 500 });
  }
}
