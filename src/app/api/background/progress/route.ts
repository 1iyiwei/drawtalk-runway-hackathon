import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RunProgress } from "@/lib/api-types";
import { getRunway } from "@/lib/runway";
import { JOB_ID_RE, JOBS_DIR } from "@/lib/backgrounds";

// GET /api/background/progress?job=<jobId> — status and progress of a background job.
export async function GET(request: Request) {
  const job = new URL(request.url).searchParams.get("job") ?? "";
  if (!JOB_ID_RE.test(job)) return Response.json({ error: "Bad job id." }, { status: 400 });
  let taskId: string;
  try {
    ({ taskId } = JSON.parse(await readFile(path.join(JOBS_DIR, `${job}.json`), "utf8")));
  } catch {
    return Response.json({} satisfies RunProgress); // task not created yet
  }
  try {
    const task = await getRunway().tasks.retrieve(taskId);
    return Response.json({
      taskStatus: task.status,
      progress: task.status === "RUNNING" ? task.progress : task.status === "SUCCEEDED" ? 1 : 0,
    } satisfies RunProgress);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
