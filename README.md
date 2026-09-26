# Runway Hackathon (Sept 30, 2026)

Next.js + [`@runwayml/sdk`](https://docs.dev.runwayml.com) starter for the
[Runway Hackathon](https://hackathon.runway.com/).

## Setup

```bash
cp .env.local.example .env.local   # then paste your key from https://dev.runway.com
npm install
npm run dev                        # http://localhost:3000
```

`RUNWAYML_API_SECRET` stays server-side (`src/lib/runway.ts`); never import that from client code.

## What's here

- `src/app/api/generate/route.ts`: POST form → `gen4.5` text-to-video, or image-to-video
  when an image is attached (uploaded via `uploads.createEphemeral`). Uses
  `.create(...).waitForTaskOutput()` and maps `TaskFailedError` to a 422.
- `src/app/page.tsx`: prompt / ratio / duration / first-frame form and video player.
- `.agents/skills/runway-dev*`: Runway Dev agent skills (installed via `npx skills add runwayml/skills`).

## Notes

- Request fields are per-model. Check https://docs.dev.runwayml.com/api.md before switching models.
- Costs: https://docs.dev.runwayml.com/guides/pricing.md
- Output URLs expire in 24–48h; download anything you want to keep.
