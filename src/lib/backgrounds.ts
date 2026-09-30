import path from "node:path";

// Generated background images (git-ignored), plus job files mapping a client job id
// to its Runway task id for progress polling.
export const BACKGROUNDS_DIR = path.join(process.cwd(), "backgrounds");
export const JOBS_DIR = path.join(BACKGROUNDS_DIR, ".jobs");
export const JOB_ID_RE = /^[a-z0-9-]{8,40}$/;
