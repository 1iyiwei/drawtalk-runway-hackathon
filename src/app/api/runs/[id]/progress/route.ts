import type { RunProgress, RunStatus } from "@/lib/api-types";
import { getRunway } from "@/lib/runway";
import { readRunJson } from "@/lib/runs";

// GET /api/runs/<id>/progress — the Runway task's status and progress (0-1).
// Runway updates a task at most every ~5 s, so poll no faster than that.
export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]/progress">) {
  const { id } = await ctx.params;
  let status: RunStatus;
  try {
    status = await readRunJson<RunStatus>(id, "status.json");
  } catch {
    return Response.json({ error: "Unknown run." }, { status: 404 });
  }
  // Older runs have the task id only in task.json.
  const taskId =
    status.taskId ?? (await readRunJson<{ id?: string }>(id, "task.json").catch(() => null))?.id;
  if (!taskId) return Response.json({} satisfies RunProgress);
  try {
    const task = await getRunway().tasks.retrieve(taskId);
    const body: RunProgress = {
      taskStatus: task.status,
      progress: task.status === "RUNNING" ? task.progress : task.status === "SUCCEEDED" ? 1 : 0,
    };
    return Response.json(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
