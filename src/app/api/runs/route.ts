import { access, readdir } from "node:fs/promises";
import type { RunStatus, RunSummary, SavedRequest } from "@/lib/api-types";
import { readRunJson, RUNS_DIR, runPath } from "@/lib/runs";

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

// Runs generated before status.json existed: derive it from task.json / output.mp4.
async function readStatus(runId: string): Promise<RunStatus | null> {
  const status = await readRunJson<RunStatus>(runId, "status.json").catch(() => null);
  if (status) return status;
  const task = await readRunJson<{ status?: string; createdAt?: string; failure?: string }>(
    runId,
    "task.json",
  ).catch(() => null);
  if (!task) return null;
  const started = task.createdAt ? Date.parse(task.createdAt) : 0;
  return task.status === "SUCCEEDED"
    ? { status: "done", started }
    : { status: "error", started, error: task.failure ?? `Generation ${task.status?.toLowerCase()}` };
}

// GET /api/runs — generated runs on disk (newest first), so a reloaded page can
// restore its run list, including runs that are still generating. Runs that were
// only planned (Check route) have no status.json and are skipped.
export async function GET() {
  let ids: string[] = [];
  try {
    ids = (await readdir(RUNS_DIR)).sort().reverse().slice(0, 50);
  } catch {
    return Response.json({ runs: [] });
  }
  const runs: RunSummary[] = [];
  for (const runId of ids) {
    try {
      const status = await readStatus(runId);
      if (!status) continue;
      const req = await readRunJson<SavedRequest>(runId, "request.json").catch(() => null);
      const routing = req?.routing as { model?: string; estimatedCost?: { credits: number } } | undefined;
      runs.push({
        ...status,
        runId,
        mode: req?.plan.mode,
        quality: req?.plan.quality,
        prompt: req?.plan.prompt,
        model: routing?.model,
        credits: routing?.estimatedCost?.credits,
        hasOutput: await exists(runPath(runId, "output.mp4")),
        hasGuideVideo: await exists(runPath(runId, "guide.mp4")),
      });
    } catch {
      // not generated, or not a run folder
    }
  }
  return Response.json({ runs });
}
