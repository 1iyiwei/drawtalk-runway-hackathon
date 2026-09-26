import { TaskFailedError } from "@runwayml/sdk";
import {
  GEN45_DURATION,
  GEN45_PROMPT_MAX,
  GEN45_RATIOS,
  type Gen45Ratio,
  getRunway,
} from "@/lib/runway";

// Generation takes seconds to minutes; allow a long-running request.
export const maxDuration = 300;

// POST multipart/form-data: prompt, ratio, duration, optional image (first frame).
// Text only -> /v1/text_to_video, with image -> /v1/image_to_video (model gen4.5).
export async function POST(request: Request) {
  const form = await request.formData();
  const prompt = String(form.get("prompt") ?? "").trim();
  const ratio = String(form.get("ratio") ?? "1280:720") as Gen45Ratio;
  const duration = Number(form.get("duration") ?? 5);
  const image = form.get("image");

  if (!prompt || prompt.length > GEN45_PROMPT_MAX) {
    return Response.json(
      { error: `Prompt must be 1-${GEN45_PROMPT_MAX} characters.` },
      { status: 400 },
    );
  }
  if (!GEN45_RATIOS.includes(ratio)) {
    return Response.json({ error: `Unsupported ratio ${ratio}.` }, { status: 400 });
  }
  if (
    !Number.isInteger(duration) ||
    duration < GEN45_DURATION.min ||
    duration > GEN45_DURATION.max
  ) {
    return Response.json(
      { error: `Duration must be ${GEN45_DURATION.min}-${GEN45_DURATION.max} seconds.` },
      { status: 400 },
    );
  }

  try {
    const client = getRunway();

    let task;
    if (image instanceof File && image.size > 0) {
      // Browser file -> ephemeral upload -> runway:// URI
      const { uri } = await client.uploads.createEphemeral({ file: image });
      task = await client.imageToVideo
        .create({ model: "gen4.5", promptText: prompt, promptImage: uri, ratio, duration })
        .waitForTaskOutput();
    } else {
      task = await client.textToVideo
        .create({ model: "gen4.5", promptText: prompt, ratio, duration })
        .waitForTaskOutput();
    }

    // Output URLs expire in 24-48h; download anything worth keeping.
    return Response.json({ taskId: task.id, output: task.output ?? [] });
  } catch (error) {
    if (error instanceof TaskFailedError) {
      const details = error.taskDetails;
      const failed = details.status === "FAILED" ? details : null;
      return Response.json(
        {
          error: failed?.failure ?? `Generation ${details.status.toLowerCase()}.`,
          failureCode: failed?.failureCode,
          taskId: details.id,
        },
        { status: 422 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
