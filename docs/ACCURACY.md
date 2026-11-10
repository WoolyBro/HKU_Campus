# Accuracy and limitations

**HKU Voxel Campus is an unofficial, stylised illustration. It must not be used for navigation,
accessibility or route planning, safety, emergency or operational decisions.** Use the official
HKU Campus Map and on-site signage for those.

## Coverage

The model covers a 1536 m × 1152 m area: the HKU Main Campus, the Centennial Campus, the halls
along Pok Fu Lam Road, St. John's College and the Jockey Club Student Village, plus the
surrounding city down to the Kennedy Town waterfront and the hillside up towards Lung Fu Shan.
The Sassoon Road medical campus and other HKU sites are outside it.

## What is data-driven

| Aspect | Source | Notes |
| --- | --- | --- |
| Where buildings, roads, paths, stairs, bridges, water, woodland, pitches and car parks are | OpenStreetMap (snapshot 2026-11-10) | Volunteer-mapped; completeness varies. Rasterised to a 1 m block grid, so edges move by up to ~0.7 m |
| Terrain shape | Lands Department 5 m DTM | Published accuracy ±5 m. Can include tree canopy and elevated roads. Resampled bicubically to 1 m, lightly smoothed, then rounded to 1 m block steps |
| HKU building names and codes | Official HKU Campus Map | 58 of the 59 official locations inside the area matched to an OSM footprint (45 by name, 13 by location) |
| Other building names | OpenStreetMap (247), else Lands Department Building data (399) | 215 buildings that neither source names carry a descriptive label built from their address or nearest street — not a real name |
| Building heights, podium / tower split | Lands Department Building data (top − base level) | Used for 870 of 927 footprints; matched to OSM footprints by overlap |
| Gates, places, MTR exits | Official map points; OSM nodes | Points, not shapes |

## What is interpreted or invented

- **Terrain grading.** Roads and paths are levelled along their real centre-lines, pitches and
  ponds are flattened, building plots are terraced, and ground under bridges is interpolated.
  HKU's real podiums, lifts and multi-level walkways are far more intricate than this.
- **Architecture.** Façades, window rhythm, floor bands, parapets, roof plant, entrances and
  canopies are procedural (Tier B) or hand-styled (Tier A). Tier B wall colours follow palette
  hints taken from official photographs, not a survey.
- **Heights.** 870 of 927 footprints (54 of the 56 Tier A/B buildings) take their height from
  Lands Department building data. Each official polygon is matched to an OSM footprint by
  overlap, so a height can be wrong where the datasets disagree, and slopes make "height above
  base" ambiguous. The remaining buildings use OSM tags (24), a typical value (27), a
  placeholder (5) or one photo-based estimate. The 21 floor counts I estimated from official
  photographs remain in `data/manual-overrides.json` as a fallback only.
- **Floor counts** shown in the inspector come from OSM where tagged; otherwise they are derived
  from the height and are approximate.
- **City ground.** Flat, unmapped ground between off-campus buildings is drawn as paved city
  ground. That is an inference from the urban context, not mapped data.
- **Vegetation.** Woodland follows OSM `natural=wood` polygons where mapped; elsewhere tree
  density is a rule (steeper, unbuilt land gets more trees). Individual trees are decorative. No
  tree is placed on a building, road, court, plaza or water (tested).
- **Street furniture.** Lamps are spaced by rule along campus roads.
- **Zones.** Only "Main Campus" is an official grouping. Centennial Campus, halls and western
  sites are project groupings of official locations; zone extents are the area nearest each
  group's buildings.
- **Underground.** HKU Station and the MTR tunnels are not modelled. The station is a marker and
  its six street exits are points.

## Building tiers — never mixed up

| Tier | Count | Meaning |
| --- | --- | --- |
| A — landmark model | 12 | Real footprint + bespoke block model checked against official photographs |
| B — detailed footprint model | 44 | Real footprint, official heights, procedural façade with palette hints from official photos |
| C — context model | 871 | Off-campus buildings: real footprint, official height and podium / tower shape where available, **generic façade that is not specific to the building**. Six with no height data or under construction stay plain massing |

A Tier C building's geometry is always labelled *stylised / approximate* and is never reported as
verified geometry, even when its height is official (enforced by
a unit test). Tier A landmarks: Main Building, Hung Hing Ying Building, Eliot Hall, May Hall,
Fung Ping Shan Building, Tang Chi Ngong Building, The Jockey Club Tower, Run Run Shaw Tower,
Cheng Yu Tung Tower, Robert Black College, Run Run Shaw Heritage House, Kadoorie Biological
Sciences Building. On the Main Building, the position and proportions of the clock tower and
turrets are my interpretation of the photographs, not measured.

## Geometry confidence

| Class | Count | Rule |
| --- | --- | --- |
| Verified geometry | 47 | OSM footprint matched to an official HKU location **and** the official map point lies within 45 m of the footprint |
| Inferred geometry | 9 | OSM footprint without that cross-check |
| Stylised / approximate | 871 | Tier C |

The overlay uses a pattern (solid / diagonal stripes / checker) and a text legend as well as colour.

## Height hierarchy

1. **Verified** — Lands Department building data (top minus base level of the overlapping official polygon).
2. **OSM `height`**, else **OSM `building:levels`** × floor height (3.5 m; 3.1 m residential).
3. **Reference estimate** — floor count estimated from official photographs, recorded in
   `data/manual-overrides.json` with confidence. Estimates, not measurements.
4. **Category heuristic** — a typical floor count for the building type.
5. **Placeholder** — 7 m.

The inspector shows the source and confidence for every building.

## Validation performed

- **Landmark coordinates** (`tests/landmarks.test.ts`): ten buildings — Main Building, K.K. Leung
  Building, Knowles Building, Hung Hing Ying Building, Haking Wong Building, Chong Yuet Ming
  Amenities Centre, The Jockey Club Tower, Cheng Yu Tung Tower, Eliot Hall, Starr Hall — are
  checked against the latitude / longitude published on the official HKU map. Each official point
  falls on or within 20 m of the modelled footprint.
- **All matched locations**: distance from the official map point to the OSM footprint —
  median 0 m, 90th percentile 1 m, maximum 10 m (`data/processed/build-report.json`).
- **Relative layout and relief**: the Centennial Campus west of the Main Building, the halls
  further west, Robert Black College uphill to the south; Kennedy Town near sea level, the Main
  Building around 75 m, upper University Drive more than 20 m higher.
- **Grounding**: every major building reaches the terrain and rises above it.
- **Trees** never stand on buildings, roads, courts, plazas or water.

## Not done

- No comparison against aerial imagery; placement was cross-checked only between OSM, the
  official map points and the DTM.
- No field survey, no building-by-building façade or height verification.
- One official location has no OSM footprint and appears only as a point: Pokfield Campus (in
  progress). Some official locations inside larger buildings (Loke Yew Hall, Chi Wah Learning
  Commons, Lui Che Woo Law Library, Global Lounge…) are searchable aliases of their host building.
- The construction site mapped at University Drive No. 2 is shown as approximate massing.
- Interiors, podium levels, lifts, escalators and building passages are not modelled.
