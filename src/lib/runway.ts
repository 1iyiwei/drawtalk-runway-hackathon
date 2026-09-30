import RunwayML from "@runwayml/sdk";
import type { VideoCreateParams } from "@runwayml/sdk/resources/generate/video";

// Server-side only: reads RUNWAYML_API_SECRET from the environment.
// Never import this from a client component.
export function getRunway() {
  if (!process.env.RUNWAYML_API_SECRET) {
    throw new Error(
      "RUNWAYML_API_SECRET is not set. Add it to .env.local (see .env.local.example).",
    );
  }
  return new RunwayML();
}

// Model Router configs, created in the Developer Portal.
export const ROUTER_CONFIGS = {
  preview: "drawtalk-preview", // optimized for latency
  final: "drawtalk-final", // optimized for quality
} as const;
export type Quality = keyof typeof ROUTER_CONFIGS;

export type RouterVideoInput = VideoCreateParams.Input;

// Dry-run a routed video request: returns the routing decision (model, estimated
// cost) without generating or billing. The SDK doesn't expose dryRun yet, so this
// uses HTTP as documented at https://docs.dev.runwayml.com/model-routers/generating.md
export async function dryRunVideo(configId: string, input: RouterVideoInput) {
  const secret = process.env.RUNWAYML_API_SECRET;
  if (!secret) throw new Error("RUNWAYML_API_SECRET is not set.");
  const res = await fetch("https://api.dev.runwayml.com/v1/generate/video", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "X-Runway-Version": "2024-11-06",
    },
    body: JSON.stringify({ configId, dryRun: true, input }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error ?? body?.message ?? `Dry run failed (HTTP ${res.status})`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return body as {
    routing?: { model: string; configId: string; estimatedCost?: { credits: number } };
  };
}
