# Data sources and licences

All sources were identified and their terms checked on **2026-11-10**, before any modelling.
The machine-readable version of this page is
[`data/source-manifest.json`](../data/source-manifest.json), which the site's
*About → Sources & licences* panel reads directly.

## 1. OpenStreetMap (via the Overpass API)

| | |
| --- | --- |
| URL | <https://www.openstreetmap.org/> |
| Licence | Open Database License (ODbL) 1.0 — <https://www.openstreetmap.org/copyright> |
| Accessed | 2026-11-10 (OSM base timestamp 2026-11-10T14:44Z) |
| Used for | The HKU Main Campus boundary polygon (relation 4246029, `amenity=university`); building footprints and tags; roads, footpaths, steps, bridges; water, coastline, woodland, grass, gardens; pitches, car parks, squares; entrances, the MTR station node and its exits, named points |
| How | One reproducible query by `scripts/fetch-osm.ts`, limited to the study-area polygon and to the feature keys the model needs. Raw response, query text and timestamp are cached in `data/raw/` |
| Attribution | "© OpenStreetMap contributors" — shown permanently in the site footer |
| Published? | Yes, as derived block data (rasterised, meshed). Derived databases remain under ODbL |

The website never contacts Overpass. No OSM raster tiles are downloaded.

## 2. Lands Department, HKSAR Government — Digital Terrain Model (5 m)

| | |
| --- | --- |
| URL | <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-5m-grid-dtm> (file `Whole_HK_DTM_5m.zip`) |
| Licence | DATA.GOV.HK Terms and Conditions of Use — <https://data.gov.hk/en/terms-and-conditions> |
| Accessed | 2026-11-10 |
| Used for | Terrain elevation: a 326 × 249 cell crop, resampled to the 1 m project grid |
| Attribution | "Terrain: Digital Terrain Model © The Government of the Hong Kong SAR (Lands Department), from DATA.GOV.HK" — shown in the footer and Sources panel |
| Published? | Yes, as derived block heights. The terms allow free commercial and non-commercial reproduction and distribution provided the source is identified and the Government's ownership acknowledged |

Notes from the publisher: accuracy ±5 m; the surface includes non-ground information such as
elevated roads and bridges, and vegetation height where land is covered by vegetation.

## 3. Lands Department, HKSAR Government — Building dataset

| | |
| --- | --- |
| URL | <https://data.gov.hk/en-data/dataset/hk-landsd-openmap-landsd-building> (CSDI dataset `landsd_rcd_1637211194312_35158`, WFS) |
| Licence | DATA.GOV.HK Terms and Conditions of Use — <https://data.gov.hk/en/terms-and-conditions> |
| Accessed | 2026-11-10 |
| Used for | 1,604 building polygons in the study area: official building names (English / Chinese), base and top heights, podium / tower type. They name buildings OpenStreetMap leaves unnamed, supply building heights, and give the podium / tower split. Footprints still come from OpenStreetMap |
| How | One paged WFS request by `scripts/fetch-landsd-buildings.ts`; raw response cached in `data/raw/`, a slim copy kept in `data/processed/landsd-buildings.geojson` |
| Attribution | "Building data © The Government of the Hong Kong SAR (Lands Department), from DATA.GOV.HK" — shown in the footer and Sources panel |
| Published? | Yes, as derived block heights and names, and as the slim processed copy, with attribution |

The official polygons are matched to OSM footprints by raster overlap, so a value can be
mis-assigned where the two datasets disagree.

## 4. The University of Hong Kong — official HKU Campus Map

| | |
| --- | --- |
| URL | <https://www.maps.hku.hk/> (location list and per-location data behind the map) |
| Rights | © The University of Hong Kong. **No open licence.** |
| Accessed | 2026-11-10 |
| Used for | Authoritative naming and semantics: location names (English / Chinese), building codes (`MB`, `KK`…), campus grouping, facility names and the published map points. Also the cross-check for building placement |
| Attribution | "Building names and codes: official HKU Campus Map (© The University of Hong Kong)" |
| Published? | Only factual fields (names, codes, campus ids, point coordinates), with attribution. Raw responses, department contact details, map artwork and photographs are **not** extracted or redistributed (`data/raw/` is git-ignored) |

**Restriction stated before use:** this is not open data. The project uses it as a factual
reference for an unofficial, non-commercial educational model. Obtain HKU's permission before any
commercial use, and remove the derived names/points if HKU objects.

The official map lists Centennial Campus buildings under "Main Campus". The **Centennial Campus**,
**Residential Halls & Colleges** and **Pokfield & Kennedy Town sites** zones are therefore project
groupings of official locations, defined by official location id in
[`data/campus-zones.json`](../data/campus-zones.json).

## 5. Official HKU photographs (private reference only)

Photographs attached to official campus-map entries were viewed to understand façade colours, roof
forms, massing and approximate floor counts. **Nothing from them is shipped** — no image, crop,
trace or texture.

## 6. Lands Department — Hong Kong Imagery Map API (not used in this release)

<https://portal.csdi.gov.hk/csdi-webpage/apidoc/ImageryMapAPI> — identified as a lawful source for
future visual validation. It was **not** used to build, trace or texture anything in this
release, and imagery is never draped over the model.

## 7. Typeface

Pixelify Sans (SIL Open Font License 1.1), self-hosted through `@fontsource/pixelify-sans`.

## Deliberately not used

- Google Maps / Google Earth, Bing Maps, Apple Maps, Mapbox imagery — not used in any form. (The
  official HKU map page embeds Google Maps as its base map; only HKU's own location records were
  read, never the base map.)
- Minecraft / Mojang textures, sounds, logos, fonts, UI or game files — none. All block textures
  are original and procedural.

## Software

Vite, React, TypeScript, three.js, React Three Fiber, Zustand, Tailwind CSS, fflate (runtime);
Turf.js, proj4, osmtogeojson, tsx, Vitest, Playwright, ESLint, Prettier (build and test). All are
permissively licensed open-source packages.
