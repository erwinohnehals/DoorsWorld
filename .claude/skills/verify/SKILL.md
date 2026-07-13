---
name: verify
description: Build, launch, and drive the DoorsWorld app to verify UI changes at runtime
---

# Verifying DoorsWorld changes

Vite + React 19 + Tailwind 3 PWA in `app/`. No test suite — verification is visual/behavioral.

## Build & launch

```powershell
cd app
npm run build        # tsc -b && vite build — catches type errors
npm run dev          # background; picks a free port (5173+), read the task output for the URL
```

## Drive it (headless)

No Playwright in the repo. Install it in the session scratchpad (browsers are already cached in `%LOCALAPPDATA%\ms-playwright`, so no download):

```powershell
cd <scratchpad>; npm init -y; npm i playwright
```

Then a `.cjs` script with `require('playwright')`: `chromium.launch()`, pages at mobile (390x844) and desktop (1280x800) viewports, `page.goto(devUrl)`, screenshot.

## Useful hooks in the app

- Filter chip rows: `[role="radiogroup"]` with `aria-label="Filter by country"` / `"Filter by city"`; active chip is `[aria-checked="true"]`; the sliding pill is the `span[aria-hidden]` inside the track.
- View switch: Gallery/Map segmented control in the header.
- Animations run ~400ms — wait ~600ms after interactions before asserting positions/screenshots.

## Gotchas

- `npm run photos` (build-photos.mjs) rewrites photo assets — never run it as part of verification.
- Dev server port varies (5173–5179+); always parse it from the vite startup output.
