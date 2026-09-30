import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Every generation is saved under runs/<id>/ (gitignored): inputs, request,
// routing decision, and the output video — output URLs expire in 24-48h and
// saved runs double as demo backups.
export const RUNS_DIR = path.join(process.cwd(), "runs");

const ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/;
const FILE_RE = /^[a-z0-9_-]+\.(png|json|mp4)$/;

export function newRunId() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`;
}

export function runPath(id: string, file?: string) {
  if (!ID_RE.test(id)) throw new Error(`Invalid run id ${id}`);
  if (file !== undefined && !FILE_RE.test(file)) throw new Error(`Invalid file ${file}`);
  return file ? path.join(RUNS_DIR, id, file) : path.join(RUNS_DIR, id);
}

export async function writeRunFile(id: string, file: string, data: string | Uint8Array) {
  await mkdir(runPath(id), { recursive: true });
  await writeFile(runPath(id, file), data);
}

export async function readRunJson<T>(id: string, file: string): Promise<T> {
  return JSON.parse(await readFile(runPath(id, file), "utf8")) as T;
}

export function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Expected a PNG data URL");
  return Buffer.from(m[1], "base64");
}
