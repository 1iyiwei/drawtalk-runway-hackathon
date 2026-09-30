import { TaskFailedError } from "@runwayml/sdk";
import type { RunStatus, SavedRequest } from "@/lib/api-types";
import { getRunway } from "@/lib/runway";
import { readRunJson, writeRunFile } from "@/lib/runs";

// Generation takes seconds to minutes; allow a long-running request.
export const maxDuration = 600;

// POST { runId } — runs the request saved by /api/plan through the Model Router,
// waits for the task, and saves the output video into the run folder.
export async function POST(request: Request) {
  const { runId } = (await request.json().catch(() => ({}))) as { runId?: string };
  if (!runId) return Response.json({ error: "Missing runId." }, { status: 400 });

  let saved: SavedRequest;
  try {
    saved = await readRunJson<SavedRequest>(runId, "request.json");
  } catch {
    return Response.json({ error: `Unknown run ${runId}.` }, { status: 404 });
  }

  // status.json lets a reloaded page find runs that are still generating.
  const started = Date.now();
  const setStatus = (status: RunStatus) =>
    writeRunFile(runId, "status.json", JSON.stringify(status, null, 2));
  await setStatus({ status: "generating", started });

  try {
    const client = getRunway();
    const task = await client.generate.video
      .create({ configId: saved.configId, input: saved.input })
      .waitForTaskOutput();

    const output = task.output ?? [];
    let local: string | null = null;
    if (output[0]) {
      // Output URLs expire in 24-48h; keep a local copy.
      const res = await fetch(output[0]);
      if (res.ok) {
        await writeRunFile(runId, "output.mp4", new Uint8Array(await res.arrayBuffer()));
        local = `/api/runs/${runId}/output.mp4`;
      }
    }
    await writeRunFile(runId, "task.json", JSON.stringify(task, null, 2));
    await setStatus({ status: "done", started, finished: Date.now(), output: output[0] });
    return Response.json({ runId, taskId: task.id, output, local });
  } catch (error) {
    if (error instanceof TaskFailedError) {
      const details = error.taskDetails;
      await writeRunFile(runId, "task.json", JSON.stringify(details, null, 2));
      const failed = details.status === "FAILED" ? details : null;
      await setStatus({
        status: "error",
        started,
        finished: Date.now(),
        error: failed?.failure ?? `Generation ${details.status.toLowerCase()}.`,
      });
      return Response.json(
        {
          runId,
          error: failed?.failure ?? `Generation ${details.status.toLowerCase()}.`,
          failureCode: failed?.failureCode,
          taskId: details.id,
        },
        { status: 422 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    await setStatus({ status: "error", started, finished: Date.now(), error: message });
    return Response.json({ runId, error: message }, { status: 500 });
  }
}
