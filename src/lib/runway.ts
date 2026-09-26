import RunwayML from "@runwayml/sdk";

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

// gen4.5 constraints from https://docs.dev.runwayml.com/api.md.
// Only these two ratios are valid for gen4.5 on BOTH text_to_video and image_to_video.
export const GEN45_RATIOS = ["1280:720", "720:1280"] as const;
export type Gen45Ratio = (typeof GEN45_RATIOS)[number];
export const GEN45_DURATION = { min: 2, max: 10 } as const;
export const GEN45_PROMPT_MAX = 1000;
