# HKU Voxel Campus

**A data-informed block-scale digital recreation of The University of Hong Kong.**

A standalone interactive website that presents the HKU Main Campus, the Centennial Campus and the
halls and hillside around them as one connected, explorable voxel world: block-stepped real
terrain from the harbour up to Lung Fu Shan, real road and path networks, building footprints
rebuilt as block architecture, the surrounding high-rise city with official building names and
heights, and day / sunset /
night lighting — at **1 block = 1 metre**.

It is **not** a game world, mod, server or download, it needs no game installation, and it uses
**no game assets**: every texture is generated procedurally in [`src/lib/voxel/textures.ts`](src/lib/voxel/textures.ts).

> Unofficial. Not affiliated with or endorsed by HKU. **Not for navigation, accessibility
> planning, safety or operational decisions.** See [docs/ACCURACY.md](docs/ACCURACY.md).

![Isometric overview](docs/screenshots/01-overview-isometric.png)

## What you can do

- Land on an orthographic three-quarter overview, then orbit, pan and zoom.
- Switch between **Isometric** (orthographic), **Orbit** (perspective) and **Explore** (first-person
  walk / run / fly with terrain following and building collision), plus **Street level**.
- Search by English or Chinese name, official building code (`MB`, `KK`, `CYA`…), zone, landmark,
  road, facility or MTR exit; the camera flies there, the building pulses and an inspector opens.
- Click any building for its official name, code, zone, model tier, geometry and height confidence.
- Toggle layers (labels, terrain, buildings, trees, roads, paths & stairs, landmarks, points of
  interest, campus zones, source-confidence overlay), time of day and performance mode.
- Share the exact view: the URL always encodes camera, selection, layers and time.

## Local setup

Requires Node.js 20+ (developed on Node 22 LTS).

```bash
npm install
```

```bash
npm run dev
```

Open the printed `http://localhost:5174`. The repository ships the generated world in
`public/world/`, so the site runs immediately — no data download is needed just to view it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (port 5174) |
| `npm run build` | Type-check and produce the static production build in `dist/` |
| `npm run preview` | Serve the production build locally (port 4174) |
| `npm run typecheck` | TypeScript project check |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | Unit tests (Vitest): projection, landmark coordinates, height hierarchy, mesher, world data, search |
| `npm run test:e2e` | Playwright end-to-end tests against the production build |
| `npm run data:fetch` | Refresh spatial data: OSM extract, official HKU names, Lands Department buildings and terrain |
| `npm run data:process` | Raw OSM → clean grouped GeoJSON in `data/processed/` |
| `npm run data:terrain` | Crop and resample the terrain model to the campus grid |
| `npm run data:world` | Build the block world into `public/world/` |
| `npm run data:build` | `data:process` + `data:terrain` + `data:world` |
| `npm run data:all` | `data:fetch` + `data:build` |

First-time end-to-end setup: `npx playwright install chromium`.
Documentation screenshots: `SHOTS=1 npx playwright test e2e/screenshots.spec.ts`.
Frame-rate probe: `PERF=1 npx playwright test e2e/perf.spec.ts`.

## Data refresh workflow

1. `npm run data:fetch` — one bounded Overpass query for the study-area polygon (cached in
   `data/raw/osm-hku.json` with the query text and timestamp), the official HKU Campus Map
   location data (about 110 small requests, cached), and the Lands Department 5 m terrain model
   (~29 MB download, ~300 MB unpacked). Cached files are reused; pass `--force` to a fetch script
   to refresh. `data/raw/` is git-ignored. The campus boundary (`data/campus-boundary.geojson`)
   is treated as curated and never overwritten.
2. `npm run data:build` — regenerates `data/processed/*`, `data/terrain/*` and `public/world/*`.
3. `npm test` — the landmark-coordinate, grounding and tree-placement tests validate the new world.
4. Review `data/processed/build-report.json` (official ↔ OSM matches) and record any correction in
   [`data/manual-overrides.json`](data/manual-overrides.json) — every entry needs evidence,
   confidence, reason and date, or the build fails.

The published site never queries Overpass or any map service at runtime.

## Deployment (Vercel)

The site is fully static.

1. Push the repository to GitHub / GitLab / Bitbucket.
2. In Vercel choose **Add New → Project** and import the repository.
3. Vercel detects Vite. The included [`vercel.json`](vercel.json) sets build command
   `npm run build`, output directory `dist`, and cache headers. No environment variables.
4. Deploy. (CLI alternative: `npx vercel` for a preview, `npx vercel --prod` for production.)

Netlify and Cloudflare Pages work the same way: build `npm run build`, publish `dist`
(`public/_headers` provides cache headers for both).

## Source attribution

- Map geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL 1.0.
- Terrain (Digital Terrain Model, 5 m) and building names / heights (Building dataset)
  © The Government of the Hong Kong SAR, Lands Department, via DATA.GOV.HK.
- Building names, codes, campus grouping, facility names and map points: the official
  [HKU Campus Map](https://www.maps.hku.hk/), © The University of Hong Kong (facts only; not an
  open dataset).
- Pixelify Sans typeface, SIL OFL 1.1.

Full details, licence status and restrictions: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) and
[`data/source-manifest.json`](data/source-manifest.json).

## Performance notes

- Geometry is drawn as GPU-instanced block quads (12 bytes per merged rectangle) — terrain is
  meshed in a Web Worker, nearest chunks first, so the page never freezes while loading.
- Terrain has two levels of detail; trees have three; small props are distance-culled; the
  shadow map is re-rendered only when something changes.
- The HKU world is 1536 × 1152 blocks, with ~400 000 structure quads
  and ~20 500 trees. **Performance mode** (auto-enabled on touch devices) thins trees, disables
  shadows, props and clouds, shortens draw distance and lowers resolution.
- Shipped world data ≈ 2.1 MB of binary plus a 0.55 MB feature catalogue (before HTTP compression).

## Limitations

- Architecture is stylised; twelve landmarks have bespoke models.
- Heights come from Lands Department building data for 870 of 927 footprints, matched to OSM
  footprints by overlap — a few may be mis-assigned. The rest use OSM tags or estimates.
- The 871 off-campus (Tier C) buildings have real footprints, heights and podium / tower shapes
  but a generic façade. 215 buildings that no source names carry a descriptive label
  ("Residential block, Hill Road"), not a real name.
- Flat unmapped city ground is drawn as paving.
- HKU Station and the MTR line are underground and not modelled; only the station and exits are marked.
- The Sassoon Road medical campus and other HKU sites are outside the modelled area.
- See [docs/ACCURACY.md](docs/ACCURACY.md) for the full list.

## Documentation

- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — every source, licence and attribution
- [docs/ACCURACY.md](docs/ACCURACY.md) — what is and is not accurate, validation results
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — coordinates, pipeline, chunking, rendering
