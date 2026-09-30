import type { Quality, RouterVideoInput } from "@/lib/runway";

// How the flattened guide image conditions the video:
//   first        guide image (background + drawn paths) is the first frame
//   reference    guide image is a reference; the model makes its own first frame
//   clean-first  clean background is the first frame, guide image is a reference
export type Mode = "first" | "reference" | "clean-first";

export type PlanRequest = {
  quality: Quality;
  mode: Mode;
  aspectRatio: "16:9" | "9:16";
  duration: number;
  prompt: string;
  negativePrompt?: string;
  guide: string; // PNG data URL: background + paths + dots/arrows
  clean?: string; // PNG data URL: background only
  scene?: unknown; // stroke data etc., saved for later analysis
};

export type SavedRequest = {
  configId: string;
  input: RouterVideoInput;
  plan: Omit<PlanRequest, "guide" | "clean">;
  routing?: unknown;
};
