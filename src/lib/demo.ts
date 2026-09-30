// Shared-demo settings (server-side). DEMO_READ_ONLY=1 disables the routes that spend
// Runway credits, so visitors can draw, preview and browse saved runs for free.
export function readOnlyResponse(): Response | null {
  if (process.env.DEMO_READ_ONLY !== "1") return null;
  return Response.json(
    {
      error:
        "Generation is disabled in this shared demo (it would spend the author's Runway credits). Draw, preview motion, Check route, and browse the saved runs below.",
    },
    { status: 403 },
  );
}
