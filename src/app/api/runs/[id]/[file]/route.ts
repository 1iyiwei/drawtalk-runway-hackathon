import { readFile } from "node:fs/promises";
import { runPath } from "@/lib/runs";

const TYPES: Record<string, string> = {
  png: "image/png",
  json: "application/json",
  mp4: "video/mp4",
  jpg: "image/jpeg",
};

// Serve saved run files (guide.png, output.mp4, request.json, ...).
export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]/[file]">) {
  const { id, file } = await ctx.params;
  try {
    const data = await readFile(runPath(id, file));
    const ext = file.split(".").pop()!;
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
