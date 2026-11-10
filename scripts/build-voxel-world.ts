/**
 * build-voxel-world.ts — combines terrain and every processed feature layer into the shipped
 * block world (public/world/*):
 *
 *   columns.bin     per-column terrain height, surface block, structure extents, pick ids, zone grid
 *   structures.bin  greedy-meshed building / bridge / detail quads, grouped by chunk
 *   trees.bin       instanced vegetation
 *   props.bin       instanced lamps, shelters, fences, shrubs…
 *   features.json   searchable / inspectable features with names, codes, confidence
 *   world.json      metadata, chunk index, zones, statistics
 *
 * All geometry originates from a geographic coordinate (OSM, Lands Department DTM, official HKU
 * map points) or from a documented entry in data/manual-overrides.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import type { LineString, MultiPolygon, Point, Polygon } from 'geojson'
import { ANCHOR, BLOCKS_PER_METRE, SEA_LEVEL, WORLD, Y_BIAS } from '../src/lib/geo/constants'
import { estimateHeight } from '../src/lib/geo/height'
import { worldToLonLat } from '../src/lib/geo/projection'
import { M, ZONE_COLOURS } from '../src/lib/voxel/palette'
import { QuadSink, Volume, meshVolume } from '../src/lib/voxel/mesher'
import { PROP, PROP_STRIDE, TREE, TREE_STRIDE, type FeatureRecord, type StructureGroup, type WorldMeta, type ZoneInfo } from '../src/lib/voxel/world-format'
import { D, N, W, distanceTo, hash2, lineLength, percentile, pointAlong, projectLine, rasterPolygon, ringsOf, stampLine, strSeed, toGrid, valueNoise } from './world/grid'
import { applyAreas, applyBridges, applyPaths, applyRoads, applyStreams, blendShoulders, inpaint, lineRecs, makeSea, type F } from './world/terrain-pass'
import { approx, canopy, entrances, makeVolume, massing, pickContextStyle, pickStyle, prepare } from './world/buildings'
import { LANDMARKS, MODELS, OPEN_MODELS } from './world/landmarks'
import type { Bld, OfficialBuilding, State } from './world/types'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const J = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))
const G = (name: string) => J(`data/processed/${name}.geojson`).features as F[]
const OUT = resolve(ROOT, 'public/world')
const t0 = Date.now()
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

// ───────────────────────── inputs ─────────────────────────
const buildings = G('buildings'),
  roadsF = G('roads'),
  pathsF = G('paths'),
  stairsF = G('stairs'),
  bridgesF = G('bridges')
const waterF = G('waterways'),
  vegF = G('vegetation'),
  facF = G('facilities'),
  transF = G('transport'),
  terrF = G('terrain-features')
const official = J('data/processed/official-hku.json')
const zonesCfg = J('data/campus-zones.json').zones as { id: number; nameEn: string; nameZh: string; source: string; enabled: boolean; expandRadiusM: number }[]
const overridesFile = J('data/manual-overrides.json')
const boundary = J('data/campus-boundary.geojson')
const osmMeta = J('data/raw/osm-hku.meta.json')

const REQUIRED = ['target', 'field', 'original', 'corrected', 'correctionType', 'evidence', 'confidence', 'reason', 'date']
const overrides = new Map<string, Record<string, unknown>>()
for (const o of overridesFile.overrides as Record<string, unknown>[]) {
  for (const k of REQUIRED) if (!(k in o)) throw new Error(`manual override for ${String(o.target)} is missing "${k}"`)
  const cur = overrides.get(o.target as string) ?? {}
  cur[o.field as string] = o.corrected
  cur.__confidence = o.confidence
  overrides.set(o.target as string, cur)
}

const dem = readFileSync(resolve(ROOT, 'data/terrain/elevation.i16'))
const dm = new Int16Array(dem.buffer, dem.byteOffset, dem.byteLength / 2)
const elev0 = new Float32Array(N)
for (let c = 0; c < N; c++) elev0[c] = dm[c] / 10

const S: State = {
  elev: Float32Array.from(elev0),
  elev0,
  H: new Uint16Array(N),
  surf: new Uint8Array(N),
  cover: new Uint8Array(N),
  sea: new Uint8Array(N),
  lock: new Uint8Array(N),
  bld: new Uint16Array(N),
  sBot: new Uint16Array(N),
  sTop: new Uint16Array(N),
  sFeat: new Uint16Array(N),
  campus: new Uint8Array(N),
  entrances: [],
}
for (const c of rasterPolygon(ringsOf(boundary.features[0].geometry))) S.campus[c] = 1
for (const f of facF)
  if (f.properties.kind === 'entrance' && f.geometry.type === 'Point') {
    const [gx, gz] = toGrid((f.geometry as Point).coordinates[0], (f.geometry as Point).coordinates[1])
    S.entrances.push({ gx, gz, main: f.properties.tags.entrance === 'main' })
  }

// ───────────────────────── buildings: footprints + naming ─────────────────────────
const norm = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/building/g, 'bldg')
    .replace(/[^a-z0-9㐀-鿿]/g, '')
const blds: Bld[] = []
function categoryOf(tags: Record<string, string>, name: string, o?: OfficialBuilding): string {
  const bt = tags.building ?? ''
  if (bt === 'roof' || tags.amenity === 'shelter' || tags.man_made === 'canopy') return 'canopy'
  if (bt === 'train_station') return 'station'
  if (o?.hostelType) return 'residence'
  if (tags.leisure === 'sports_centre' || tags.leisure === 'stadium' || bt === 'grandstand' || /sports|stadium|gymnasium/i.test(name)) return 'sports'
  if (bt === 'church' || bt === 'chapel' || tags.amenity === 'place_of_worship' || /chapel/i.test(name)) return 'worship'
  if (tags.amenity === 'library' || /library/i.test(name)) return 'library'
  if (bt === 'hotel' || tags.tourism === 'hotel') return 'hotel'
  if (bt === 'hospital' || tags.amenity === 'hospital') return 'hospital'
  if (['dormitory', 'apartments', 'residential', 'guest_house'].includes(bt)) return 'residence'
  if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(bt)) return 'house'
  if (['service', 'industrial', 'warehouse', 'booth', 'shed', 'garage', 'garages'].includes(bt) || tags.man_made === 'pumping_station' || tags.power) return 'utility'
  if (['office', 'commercial', 'retail', 'civic', 'museum'].includes(bt)) return 'office'
  if (bt === 'university' || bt === 'college' || bt === 'school' || o) return 'academic'
  return 'unknown'
}

for (const f of buildings) {
  const { tags, id, kind, inCampus, flags } = f.properties
  if (tags.location === 'underground' || (Number(tags.layer) < 0 && !tags['building:levels'])) continue
  const rings = ringsOf(f.geometry as Polygon | MultiPolygon)
  if (!rings.length) continue
  const cells = rasterPolygon(rings)
  if (cells.length < 4) continue
  let i0: number = W,
    j0: number = D,
    i1 = 0,
    j1 = 0,
    sx = 0,
    sz = 0
  for (const c of cells) {
    const i = c % W,
      j = (c / W) | 0
    i0 = Math.min(i0, i)
    i1 = Math.max(i1, i)
    j0 = Math.min(j0, j)
    j1 = Math.max(j1, j)
    sx += i
    sz += j
  }
  const nameEn = tags['name:en'] ?? (tags.name && /[a-zA-Z]/.test(tags.name) ? tags.name.replace(/[㐀-鿿（）()]+/g, ' ').trim() : '') ?? ''
  const nameZh = tags['name:zh'] ?? tags['name:zh-Hant'] ?? (tags.name && /[㐀-鿿]/.test(tags.name) ? (tags.name.match(/[㐀-鿿（）—·]+/g) ?? []).join('') : '')
  blds.push({
    idx: 0,
    id,
    tags,
    kind,
    inCampus,
    flags,
    rings,
    cells,
    i0,
    j0,
    i1,
    j1,
    areaM2: cells.length / (BLOCKS_PER_METRE * BLOCKS_PER_METRE),
    cx: sx / cells.length + 0.5,
    cz: sz / cells.length + 0.5,
    aliases: [],
    nameEn,
    nameZh,
    category: 'unknown',
    zoneId: 0,
    tier: 'C',
    levels: 1,
    heightM: 4,
    heightSource: 'placeholder',
    heightConfidence: 'low',
    hBlocks: 4,
    floorH: 4,
    base: 0,
    top: 0,
    geom: 'inferred',
    notes: [],
  })
}
// stable order → stable feature indices
blds.sort((a, b) => (a.id < b.id ? -1 : 1))
blds.forEach((b, k) => {
  b.idx = k + 1
})
const isOpen = (b: Bld) => b.category === 'canopy' || b.category === 'station' || (b.landmark ? OPEN_MODELS.has(b.landmark.model) : false)

// provisional occupancy grid for official matching (largest buildings last so they win overlaps)
const occ = new Uint16Array(N)
for (const b of [...blds].sort((a, c) => a.cells.length - c.cells.length)) for (const c of b.cells) occ[c] = b.idx

const nameIndex = new Map<string, Bld[]>()
for (const b of blds) {
  const names = [
    b.tags['name:en'],
    b.tags.name,
    b.tags.alt_name,
    b.tags['alt_name:en'],
    b.tags.official_name,
    b.tags['official_name:en'],
    b.tags.old_name,
    b.tags['addr:housename:en'],
    b.tags['name:zh'],
    b.tags['name:zh-Hant'],
    b.tags['alt_name:zh'],
    b.nameEn,
    b.nameZh,
  ]
  for (const n of new Set(names.map(norm).filter((x) => x.length > 1))) nameIndex.set(n, [...(nameIndex.get(n) ?? []), b])
}
const matchReport: { code: string; name: string; method: string; osm?: string; distM?: number }[] = []
function pointDist(b: Bld, gx: number, gz: number): number {
  let best = Infinity
  for (const c of b.cells) {
    const d = Math.hypot((c % W) + 0.5 - gx, ((c / W) | 0) + 0.5 - gz)
    if (d < best) best = d
  }
  return best
}
const inStudyArea = (p: { lat: number; lon: number } | null) => {
  if (!p) return false
  const [gx, gz] = toGrid(p.lon, p.lat)
  return gx >= 0 && gz >= 0 && gx < W && gz < D
}
// Only official locations inside the modelled area take part (Sassoon Road and other campuses are outside it).
const officialHere = (official.buildings as OfficialBuilding[]).filter((o) => inStudyArea(o.point) || (!o.point && (nameIndex.has(norm(o.nameEn)) || nameIndex.has(norm(o.nameZh)))))
const unmatchedOfficial: OfficialBuilding[] = []
const assign = (o: OfficialBuilding, hit: Bld, method: 'official-name' | 'official-location') => {
  const gp = o.point ? toGrid(o.point.lon, o.point.lat) : null
  if (!hit.official) {
    hit.official = o
    hit.matchMethod = method
  } else hit.aliases.push(o)
  matchReport.push({ code: o.shortCode, name: o.nameEn, method, osm: hit.id, distM: gp ? Math.round(pointDist(hit, gp[0], gp[1])) : -1 })
}
// pass 1: by name, so that a building keeps its own official record
const byLocation: OfficialBuilding[] = []
for (const o of officialHere) {
  const gp = o.point ? toGrid(o.point.lon, o.point.lat) : null
  const cands = [...(nameIndex.get(norm(o.nameEn)) ?? []), ...(nameIndex.get(norm(o.nameZh)) ?? [])]
  const scored = cands.map((b) => ({ b, d: gp ? pointDist(b, gp[0], gp[1]) : 0 })).sort((a, c) => a.d - c.d)
  if (scored.length && scored[0].d < 200) assign(o, scored[0].b, 'official-name')
  else byLocation.push(o)
}
// pass 2: by location (≤ 18 m) — also attaches facilities that live inside a larger building as aliases
for (const o of byLocation) {
  const gp = o.point ? toGrid(o.point.lon, o.point.lat) : null
  let best = 18,
    bi = 0
  if (gp) {
    const gi = Math.floor(gp[0]),
      gj = Math.floor(gp[1])
    for (let dj = -18; dj <= 18; dj++)
      for (let di = -18; di <= 18; di++) {
        const i = gi + di,
          j = gj + dj
        if (i < 0 || j < 0 || i >= W || j >= D) continue
        const v = occ[j * W + i]
        if (v) {
          const d = Math.hypot(di, dj)
          if (d < best) {
            best = d
            bi = v
          }
        }
      }
  }
  if (bi) assign(o, blds[bi - 1], 'official-location')
  else {
    unmatchedOfficial.push(o)
    matchReport.push({ code: o.shortCode, name: o.nameEn, method: 'unmatched' })
  }
}

// ───────────────────────── Lands Department building data ─────────────────────────
// Official polygons with names and base / top heights. Used for attributes only: footprints stay OSM.
const ldRel = new Int16Array(N) // per-column roof height in blocks above the owning building's base (0 = unknown)
{
  const ld = (
    J('data/processed/landsd-buildings.geojson').features as {
      properties: { type: string; nameEn: string; nameZh: string; base: number | null; top: number | null; storeys: number | null }
      geometry: MultiPolygon
    }[]
  ).filter((f) => f.properties.type !== 'Temporary Structure' && f.properties.type !== 'Open-sided Structure')
  const cellTop = new Float32Array(N).fill(NaN),
    cellBase = new Float32Array(N).fill(NaN)
  const cellPoly = new Int32Array(N).fill(-1)
  // paint large polygons first so the most specific (smallest) polygon — e.g. a tower inside its podium — wins a column
  const raster = ld.map((f, k) => ({ k, cells: rasterPolygon(ringsOf(f.geometry)) })).sort((a, c) => c.cells.length - a.cells.length)
  for (const { k, cells } of raster) {
    const { base, top, nameEn, nameZh } = ld[k].properties
    for (const c of cells) {
      if (top !== null && base !== null && top - base >= 2) {
        cellTop[c] = top
        cellBase[c] = base
      }
      if (cellPoly[c] < 0 || nameEn || nameZh) cellPoly[c] = k
    }
  }
  const tidy = (n: string) => (n && n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s\-(/])([a-z])/g, (_m, a: string, ch: string) => a + ch.toUpperCase()) : n)
  let withHeight = 0,
    withName = 0
  for (const b of blds) {
    const votes = new Map<number, number>()
    const bases: number[] = [],
      covered: number[] = []
    for (const c of b.cells) {
      if (cellPoly[c] >= 0) votes.set(cellPoly[c], (votes.get(cellPoly[c]) ?? 0) + 1)
      if (!Number.isNaN(cellTop[c])) {
        bases.push(cellBase[c])
        covered.push(c)
      }
    }
    let nameEn = '',
      nameZh = '',
      best = 0,
      storeys: number | null = null
    for (const [k, n] of votes) {
      const pr = ld[k].properties
      if ((pr.nameEn || pr.nameZh) && n > best && (n >= b.cells.length * 0.2 || n >= 40)) {
        best = n
        nameEn = tidy(pr.nameEn)
        nameZh = pr.nameZh
      }
      if (pr.storeys && (storeys === null || pr.storeys > storeys) && n >= b.cells.length * 0.15) storeys = pr.storeys
    }
    const coverage = covered.length / b.cells.length
    let heightM = 0
    if (coverage >= 0.4) {
      const baseRef = percentile(bases, 0.5)
      const rels = covered.map((c) => cellTop[c] - baseRef)
      heightM = Math.round(percentile(rels, 0.97) * 10) / 10
      if (heightM >= 2.5) for (const c of covered) if (occ[c] === b.idx) ldRel[c] = Math.max(1, Math.round((cellTop[c] - baseRef) * BLOCKS_PER_METRE))
    }
    if (heightM >= 2.5 || nameEn || nameZh) {
      b.ld = { nameEn, nameZh, heightM: heightM >= 2.5 ? heightM : 0, storeys, coverage }
      if (heightM >= 2.5) withHeight++
      if (nameEn || nameZh) withName++
    }
  }
  log(`lands department data: ${ld.length} polygons → heights for ${withHeight} footprints, names for ${withName}`)
}
// named streets, for descriptive labels of buildings that no source names
const streetPts: { x: number; z: number; name: string }[] = []
for (const f of [...roadsF, ...bridgesF, ...pathsF]) {
  const t = f.properties.tags
  const n = t['name:en'] ?? (t.name && /[a-zA-Z]/.test(t.name) ? t.name.replace(/[\u3400-\u9fff]+/g, '').trim() : '')
  if (!n || f.geometry.type !== 'LineString') continue
  const pts = projectLine((f.geometry as LineString).coordinates)
  const len = lineLength(pts)
  for (let d = 0; d <= len; d += 8) {
    const [x, z] = pointAlong(pts, d)
    streetPts.push({ x, z, name: n })
  }
}
const nearestStreet = (x: number, z: number, maxD: number) => {
  let best = maxD,
    name = ''
  for (const p of streetPts) {
    const d = Math.abs(p.x - x) + Math.abs(p.z - z)
    if (d < best * 1.5) {
      const e = Math.hypot(p.x - x, p.z - z)
      if (e < best) {
        best = e
        name = p.name
      }
    }
  }
  return name
}

// landmarks + categories + heights + tiers
const mergedLandmarks = new Set<string>()
for (const b of blds) {
  const o = b.official
  if (o) {
    b.nameEn = o.nameEn
    b.nameZh = o.nameZh
    b.zoneId = o.zoneId
  }
  if (b.ld && (b.ld.nameEn || b.ld.nameZh)) {
    if (!o && !b.nameEn && !b.nameZh) {
      b.nameEn = b.ld.nameEn
      b.nameZh = b.ld.nameZh
      b.nameFrom = 'landsd'
    } else if (norm(b.ld.nameEn) !== norm(b.nameEn)) b.aliasNames = [...(b.aliasNames ?? []), b.ld.nameEn, b.ld.nameZh].filter(Boolean)
  }
  b.category = categoryOf(b.tags, b.nameEn, o)
  if (b.kind === 'water_tower' || b.tags.man_made === 'water_tower') b.category = 'utility'
  b.landmark = LANDMARKS.find(
    (l) =>
      (l.match.code && o?.shortCode === l.match.code && b.matchMethod) ||
      (l.match.officialName && o?.nameEn === l.match.officialName && b.matchMethod) ||
      (l.match.osmId && l.match.osmId === b.id) ||
      (l.match.osmName && (b.tags['name:en'] === l.match.osmName || b.tags.name === l.match.osmName)),
  )
  const ov = overrides.get(b.id) ?? {}
  const est = estimateHeight({
    category: b.category,
    osmHeight: b.tags.height,
    osmLevels: b.tags['building:levels'],
    verifiedHeightM: (ov.verifiedHeightM as number | undefined) ?? (b.ld && b.ld.heightM > 0 ? b.ld.heightM : undefined),
    verifiedLevels: (ov.verifiedLevels as number | undefined) ?? (b.ld && b.ld.heightM > 0 ? parseInt(b.tags['building:levels'] ?? '', 10) || undefined : undefined),
    referenceHeightM: (ov.referenceHeightM as number | undefined) ?? b.landmark?.referenceHeightM,
    referenceLevels: (ov.referenceLevels as number | undefined) ?? b.landmark?.referenceLevels,
  })
  b.levels = est.levels
  b.heightM = est.heightM
  b.heightSource = est.source
  b.heightConfidence = (ov.__confidence as string) && est.source === 'reference-estimate' ? (ov.__confidence as string) : est.confidence
  b.floorH = est.floorHeightM >= 3.3 ? 4 : 3
  b.hBlocks = Math.max(3, Math.round(est.heightM * BLOCKS_PER_METRE))
  if (b.category === 'canopy' || b.category === 'station') {
    b.hBlocks = 5
    b.heightM = 5
    b.levels = 1
  }
  const named = !!(o || b.nameEn || b.nameZh)
  b.tier = b.landmark ? 'A' : (b.inCampus || o) && (named || b.tags['building:levels']) && !b.flags.includes('tiny-footprint') ? 'B' : 'C'
  if (b.flags.includes('under-construction')) {
    b.tier = 'C'
    b.notes.push('Tagged as under construction in OSM; shown as approximate massing.')
  }
  if (b.tier === 'C') b.geom = 'approximate'
  else if (o && o.point) {
    const [gx, gz] = toGrid(o.point.lon, o.point.lat)
    b.geom = pointDist(b, gx, gz) <= 45 ? 'verified' : 'inferred'
    if (b.geom !== 'verified') b.notes.push('OSM footprint lies more than 45 m from the official map point; placement not cross-checked.')
  }
  if (b.landmark) b.notes.push(b.landmark.notes)
  if (b.landmark?.officialLandmark) {
    const ol = (official.landmarks as { nameEn: string; nameZh: string; zoneId: number }[]).find((l) => l.nameEn === b.landmark!.officialLandmark)
    if (ol) {
      b.aliasNames = [b.nameEn, b.nameZh].filter(Boolean)
      b.nameEn = ol.nameEn
      b.nameZh = ol.nameZh
      b.zoneId = ol.zoneId
      b.matchMethod = 'official-location'
      mergedLandmarks.add(ol.nameEn)
    }
  }
  if (b.heightSource === 'category-heuristic' || b.heightSource === 'placeholder') b.notes.push('Height is a category-based guess (no height or floor count in public data).')
  b.plain = b.tier === 'C' && (b.flags.includes('under-construction') || b.flags.includes('tiny-footprint') || b.heightSource === 'placeholder')
  if (b.tier === 'C' && b.plain && !b.flags.includes('under-construction')) b.notes.push('Low-confidence structure shown as plain massing without architectural detail.')
  if (b.tier === 'C' && !b.plain) b.notes.push('Context building: real footprint with a generic procedural façade — windows, colours and roof details are not specific to this building.')
  if (b.heightSource === 'verified' && b.ld) b.notes.push('Height from Lands Department building data (top minus base level).')
  if (!o && !b.nameEn && !b.nameZh && b.category !== 'canopy') {
    // nobody names this building: give it a descriptive label so it is not anonymous
    const t = b.tags
    const street = (t['addr:street:en'] ?? (t['addr:street'] ?? '').replace(/[\u3400-\u9fff]+/g, '').trim()) || nearestStreet(b.cx, b.cz, 60)
    const kind =
      b.category === 'residence' || b.category === 'house'
        ? b.levels >= 15
          ? 'Residential tower'
          : 'Residential block'
        : b.category === 'office'
          ? 'Commercial building'
          : b.category === 'utility'
            ? 'Utility building'
            : b.levels >= 15
              ? 'Tower block'
              : 'Building'
    if (street) b.derivedName = t['addr:housenumber'] && (t['addr:street:en'] || t['addr:street']) ? `${t['addr:housenumber']} ${street}` : `${kind}, ${street}`
  }
  if (b.flags.includes('clipped-by-study-area')) b.notes.push('Footprint is cut by the edge of the modelled area.')
}
// Overlapping footprints (podium + tower, duplicate outlines): the most authoritative / tallest
// building owns the shared cells; footprints that end up owning almost nothing are dropped.
const prio = (b: Bld) => (b.official ? 8 : 0) + (b.landmark ? 4 : 0) + (b.tier === 'B' ? 2 : 0) + (b.nameEn || b.nameZh ? 1 : 0)
const paintOrder = (list: Bld[]) => [...list].sort((a, c) => prio(a) - prio(c) || a.hBlocks - c.hBlocks || c.cells.length - a.cells.length || (a.id < c.id ? -1 : 1))
{
  const owner = new Uint16Array(N)
  for (const b of paintOrder(blds)) if (!isOpen(b)) for (const c of b.cells) owner[c] = b.idx
  const dropped: string[] = []
  const byIdx = new Map(blds.map((b) => [b.idx, b]))
  for (const b of blds) {
    if (isOpen(b)) continue
    const owners = new Map<number, number>()
    let own = 0
    for (const c of b.cells) {
      if (owner[c] === b.idx) own++
      else owners.set(owner[c], (owners.get(owner[c]) ?? 0) + 1)
    }
    if (own / b.cells.length >= 0.3) continue
    // almost entirely covered by another footprint: fold it into that building (keeping its names searchable)
    const top = [...owners.entries()].sort((a, c) => c[1] - a[1])[0]
    const host = top ? byIdx.get(top[0]) : undefined
    if (host && (b.official || b.nameEn || b.nameZh)) {
      if (b.official) host.aliases.push(b.official, ...b.aliases)
      host.aliasNames = [...(host.aliasNames ?? []), b.nameEn, b.nameZh].filter(Boolean)
    }
    b.skip = true
    dropped.push(b.id)
  }
  if (dropped.length) log(`overlap: dropped ${dropped.length} footprints that are covered by another building`)
}
{
  const kept = blds.filter((b) => !b.skip)
  blds.length = 0
  blds.push(...kept)
  blds.forEach((b, k) => {
    b.idx = k + 1
  })
}
const genOrder = paintOrder(blds)
for (const b of genOrder) if (!isOpen(b)) for (const c of b.cells) S.bld[c] = b.idx
log(
  `buildings: ${blds.length} footprints · official matched ${matchReport.filter((m) => m.method !== 'unmatched').length}/${matchReport.length} · tiers`,
  ['A', 'B', 'C'].map((t) => `${t}:${blds.filter((b) => b.tier === t).length}`).join(' '),
)

// ───────────────────────── terrain shaping ─────────────────────────
makeSea(
  S,
  waterF.filter((f) => f.properties.kind === 'coastline'),
)
const bridgeRecs = lineRecs(
  bridgesF.filter((f) => f.geometry.type === 'LineString'),
  true,
)
{
  const mask = new Uint8Array(N)
  for (const w of bridgeRecs)
    stampLine(w.pts, w.spec.half + 3, (c) => {
      if (!S.sea[c]) mask[c] = 1
    })
  inpaint(S, mask)
}
// land cover
for (const f of vegF) {
  if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue
  const code = { wood: 1, scrub: 2, grass: 3, garden: 4, park: 4, flowerbed: 5 }[f.properties.kind] ?? 0
  if (!code) continue
  for (const c of rasterPolygon(ringsOf(f.geometry))) if (code >= S.cover[c] || S.cover[c] === 1) S.cover[c] = code
}
applyAreas(
  S,
  [...facF, ...transF.filter((f) => f.properties.kind === 'platform')],
  waterF.filter((f) => f.geometry.type !== 'LineString'),
)
applyStreams(S, waterF)
const railRecs = lineRecs(transF.filter((f) => f.properties.kind === 'rail'))
const roadRecs = [...railRecs, ...lineRecs(roadsF).filter((w) => w.spec.prio === 3)]
const pathRecs = [...lineRecs(roadsF).filter((w) => w.spec.prio === 1), ...lineRecs(pathsF), ...lineRecs(stairsF)]
applyRoads(S, roadRecs)
applyPaths(S, pathRecs)
const { decks, piers } = applyBridges(S, bridgeRecs, [...roadRecs, ...pathRecs])
blendShoulders(S)
log(`terrain: ${roadRecs.length} road/rail ways, ${pathRecs.length} path/stair ways, ${bridgeRecs.length} bridge ways → ${decks.length} elevated deck cells`)

// building terraces
for (const b of blds) {
  const ringE: number[] = []
  for (const c of b.cells) {
    const i = c % W,
      j = (c / W) | 0
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      for (const k of [1, 2]) {
        const ni = i + di * k,
          nj = j + dj * k
        if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue
        const n = nj * W + ni
        if (!S.bld[n]) ringE.push(S.elev[n])
        else if (k === 1) break
      }
  }
  const src = ringE.length >= 4 ? ringE : Array.from(b.cells, (c) => S.elev[c])
  if (isOpen(b)) {
    b.base =
      Math.round(
        percentile(
          Array.from(b.cells, (c) => S.elev[c]),
          0.9,
        ),
      ) + Y_BIAS
    continue
  }
  const baseM = Math.max(2, Math.round(percentile(src, 0.35)))
  b.base = baseM + Y_BIAS
  for (const c of b.cells) {
    if (S.bld[c] !== b.idx) continue
    S.elev[c] = Math.min(S.elev[c], baseM)
    S.sea[c] = 0
    S.lock[c] = 4
    S.surf[c] = M.PAVEMENT
  }
  for (const c of b.cells) {
    const i = c % W,
      j = (c / W) | 0
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ni = i + di,
          nj = j + dj
        if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue
        const n = nj * W + ni
        if (S.bld[n] || S.sea[n] || S.lock[n] !== 0) continue
        if (S.elev[n] > baseM + 0.5) S.elev[n] = baseM
        if (b.tier !== 'C') {
          S.surf[n] = M.PAVEMENT
          S.lock[n] = 2
        }
      }
  }
}

// ───────────────────────── finalise block heights + natural surfaces ─────────────────────────
for (let c = 0; c < N; c++) S.H[c] = S.sea[c] ? Y_BIAS + SEA_LEVEL : Math.max(Y_BIAS + 1, Math.round(S.elev[c]) + Y_BIAS)
const seaDist = distanceTo(S.sea, 4)
// Unmapped flat ground between off-campus buildings is treated as paved city ground (inferred).
const nearBuilding = distanceTo(
  Uint8Array.from(S.bld, (v) => (v ? 1 : 0)),
  24,
)
let maxH = 0
for (let j = 0; j < D; j++)
  for (let i = 0; i < W; i++) {
    const c = j * W + i
    maxH = Math.max(maxH, S.H[c])
    if (S.sea[c]) {
      S.surf[c] = M.SEA
      continue
    }
    if (S.surf[c] !== 0) continue
    const h = S.H[c]
    const slope = Math.max(Math.abs(h - S.H[i > 0 ? c - 1 : c]), Math.abs(h - S.H[i < W - 1 ? c + 1 : c]), Math.abs(h - S.H[j > 0 ? c - W : c]), Math.abs(h - S.H[j < D - 1 ? c + W : c]))
    const n1 = valueNoise(i, j, 9, 11),
      n2 = valueNoise(i, j, 37, 5),
      r = hash2(i, j, 3)
    let m: number
    if (slope >= 4 || (slope === 3 && n1 > 0.5)) m = M.ROCK
    else if (S.cover[c] === 1) m = M.FOREST_FLOOR
    else if (S.cover[c] === 2) m = M.SCRUB
    else if (S.cover[c] === 3) m = M.LAWN
    else if (S.cover[c] === 4) m = r < 0.08 ? M.GRASS_FLOWERS : M.LAWN
    else if (S.cover[c] === 5) m = r < 0.65 ? M.GRASS_FLOWERS : M.SOIL
    else if (S.cover[c] === 0 && !S.campus[c] && nearBuilding[c] <= 20 && slope <= 1) m = M.PAVEMENT
    else if (seaDist[c] <= 2 && h <= Y_BIAS + 3) m = n1 > 0.45 ? M.ROCK : M.SAND
    else if (slope >= 2 && n2 > 0.66) m = M.DIRT
    else m = r < 0.02 ? M.GRASS_FLOWERS : M.GRASS
    S.surf[c] = m
  }
log(`heights finalised: max block height ${maxH - Y_BIAS} m, sea cells ${S.sea.reduce((a, b) => a + b, 0)}`)

// ───────────────────────── structures ─────────────────────────
const sinks = new Map<number, QuadSink>()
const groupOf = (gx: number, gz: number) => Math.min(W / WORLD.chunk - 1, Math.max(0, Math.floor(gx / WORLD.chunk))) + Math.min(D / WORLD.chunk - 1, Math.max(0, Math.floor(gz / WORLD.chunk))) * 64
const sinkFor = (gx: number, gz: number) => {
  const k = groupOf(gx, gz)
  if (!sinks.has(k)) sinks.set(k, new QuadSink(4096, true))
  return sinks.get(k)!
}
const terrainTop = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= D ? 0 : S.H[j * W + i])
function commit(vol: Volume, feature: number, gx: number, gz: number): number {
  meshVolume(vol, sinkFor(gx, gz), feature, terrainTop)
  let top = 0
  for (let z = 0; z < vol.sz; z++)
    for (let x = 0; x < vol.sx; x++) {
      let lo = -1,
        hi = -1
      for (let y = 0; y < vol.sy; y++)
        if (vol.data[(y * vol.sz + z) * vol.sx + x]) {
          if (lo < 0) lo = y
          hi = y
        }
      if (lo < 0) continue
      const i = vol.ox + x,
        j = vol.oz + z
      if (i < 0 || j < 0 || i >= W || j >= D) continue
      const c = j * W + i
      const bot = vol.oy + lo,
        tp = vol.oy + hi + 1
      if (S.sTop[c] === 0) {
        S.sBot[c] = bot
        S.sTop[c] = tp
      } else {
        S.sBot[c] = Math.min(S.sBot[c], bot)
        S.sTop[c] = Math.max(S.sTop[c], tp)
      }
      if (feature) S.sFeat[c] = feature
      top = Math.max(top, tp)
    }
  return top
}

for (const b of genOrder) {
  const P = prepare(b, S)
  const tall = b.landmark?.model.startsWith('tower') ? 6 : 14
  const vol = makeVolume(b, P, tall)
  if (b.landmark && MODELS[b.landmark.model]) MODELS[b.landmark.model](vol, b, S, P)
  else if (b.category === 'station') MODELS.station(vol, b, S, P)
  else if (b.category === 'canopy') canopy(vol, b, S, P)
  else if (b.plain) approx(vol, b, S, P)
  else {
    // real footprint + (where available) official per-column heights, so podiums and towers read separately
    massing(vol, b, S, P, b.tier === 'C' ? pickContextStyle(b) : pickStyle(b), (i, j) => (S.bld[j * W + i] === b.idx ? ldRel[j * W + i] : 0))
    if (b.tier !== 'C') entrances(vol, b, S, P, b.areaM2 > 90)
  }
  b.top = commit(vol, b.idx, b.cx, b.cz) || b.base + b.hBlocks
}

// loose voxels: bridge decks, piers, covered walkways, hedges, walls, gate pillars, sculptures
const loose = new Map<number, number>()
const LK = (c: number, y: number) => y * 4194304 + c
const put = (i: number, y: number, j: number, m: number, force = false) => {
  if (i < 0 || j < 0 || i >= W || j >= D || y < 1) return
  const c = j * W + i
  if (S.bld[c] && !force) return
  const k = LK(c, y)
  if (force || !loose.has(k)) loose.set(k, m)
}
for (const d of decks) {
  const i = d.c % W,
    j = (d.c / W) | 0,
    y = d.y + Y_BIAS
  if (y - 1 <= S.H[d.c]) continue
  put(i, y - 1, j, d.mat)
  put(i, y - 2, j, M.BRIDGE_DECK)
  if (d.edge) put(i, y, j, d.foot ? M.RAILING : M.CONCRETE)
}
const deckSet = new Set(decks.map((d) => d.c))
for (const p of piers) {
  const i = Math.floor(p.x),
    j = Math.floor(p.z)
  if (i < 1 || j < 1 || i >= W - 1 || j >= D - 1) continue
  const c = j * W + i
  if (!deckSet.has(c) || S.lock[c] === 3 || S.lock[c] === 1 || S.bld[c]) continue
  const y = p.y + Y_BIAS
  if (y - 2 - S.H[c] < 4) continue
  for (const [di, dj] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ])
    for (let yy = S.H[(j + dj) * W + i + di]; yy < y - 2; yy++) put(i + di, yy, j + dj, M.COLUMN)
}
// covered walkways
let coveredCount = 0
for (const f of [...pathsF, ...stairsF]) {
  const t = f.properties.tags
  if (t.covered !== 'yes' || t.tunnel || t.indoor === 'yes' || f.geometry.type !== 'LineString') continue
  const pts = projectLine((f.geometry as LineString).coordinates)
  coveredCount++
  stampLine(pts, 1.9, (c, s, dist) => {
    if (S.bld[c] || S.sea[c] || S.sTop[c]) return
    const i = c % W,
      j = (c / W) | 0
    put(i, S.H[c] + 3, j, M.CANOPY)
    if (dist > 1.3 && Math.floor(s) % 5 === 0 && S.lock[c] !== 3) for (let y = S.H[c]; y < S.H[c] + 3; y++) put(i, y, j, M.COLUMN)
  })
}
// hedges and low walls
for (const f of vegF)
  if (f.properties.kind === 'hedge' && f.geometry.type === 'LineString') {
    stampLine(projectLine((f.geometry as LineString).coordinates), 0.6, (c) => {
      if (S.lock[c] === 0 && !S.sea[c]) put(c % W, S.H[c], (c / W) | 0, M.HEDGE)
    })
  }
for (const f of terrF)
  if ((f.properties.kind === 'wall' || f.properties.kind === 'retaining_wall') && f.geometry.type === 'LineString') {
    stampLine(projectLine((f.geometry as LineString).coordinates), 0.55, (c) => {
      if (S.lock[c] <= 1 && !S.sea[c] && S.surf[c] !== M.STAIRS) put(c % W, S.H[c], (c / W) | 0, M.WALL_STONE)
    })
  }
// Station platform canopies (stylised: OSM maps the platforms, not their roofs)
for (const f of transF) {
  if (f.properties.kind !== 'platform' || f.properties.tags.railway !== 'platform' || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue
  if (Number(f.properties.tags.layer) < 0 || f.properties.tags.location === 'underground' || f.properties.tags.tunnel || f.properties.tags.indoor === 'yes') continue
  const cells = rasterPolygon(ringsOf(f.geometry))
  const set = new Set(cells)
  for (const c of cells) {
    if (S.bld[c]) continue
    const i = c % W,
      j = (c / W) | 0
    const edge = !set.has(c - 1) || !set.has(c + 1) || !set.has(c - W) || !set.has(c + W)
    put(i, S.H[c] + 5, j, edge ? M.ACCENT_BLUE : M.ROOF_METAL)
    if (!edge && (i + j * 3) % 9 === 0 && set.has(c - 2) && set.has(c + 2) && set.has(c - 2 * W) && set.has(c + 2 * W)) for (let y = S.H[c]; y < S.H[c] + 5; y++) put(i, y, j, M.COLUMN)
  }
}
// No symbolic structures are generated for HKU: gates and places are shown as official map points only.
const specials: { name: string; gx: number; gz: number; note: string }[] = []
// tile loose voxels into volumes and mesh them
{
  const tiles = new Map<number, { cells: [number, number, number, number][]; y0: number; y1: number }>()
  for (const [k, m] of loose) {
    const y = Math.floor(k / 4194304),
      c = k - y * 4194304
    const i = c % W,
      j = (c / W) | 0
    const tk = groupOf(i, j)
    let t = tiles.get(tk)
    if (!t) {
      t = { cells: [], y0: y, y1: y }
      tiles.set(tk, t)
    }
    t.cells.push([i, y, j, m])
    t.y0 = Math.min(t.y0, y)
    t.y1 = Math.max(t.y1, y)
  }
  for (const [tk, t] of tiles) {
    const cx = tk % 64,
      cz = Math.floor(tk / 64)
    const vol = new Volume(cx * WORLD.chunk, t.y0, cz * WORLD.chunk, WORLD.chunk, t.y1 - t.y0 + 1, WORLD.chunk)
    for (const [i, y, j, m] of t.cells) vol.set(i, y, j, m)
    commit(vol, 0, cx * WORLD.chunk + 1, cz * WORLD.chunk + 1)
  }
}
log(`structures: ${loose.size} loose voxels (decks, walkways, hedges, walls), ${coveredCount} covered walkways`)

// ───────────────────────── zones ─────────────────────────
const ZS = 4,
  zw = W / ZS,
  zd = D / ZS
const zoneGrid = new Uint8Array(zw * zd)
const stationZone = zonesCfg.find((z) => z.source === 'anchor-radius')
const stationNodes = transF.filter((f) => f.properties.kind === 'station' && f.geometry.type === 'Point')
const hkuStation = stationNodes.find((f) => /HKU|香港大學/.test(f.properties.tags.name ?? ''))
{
  const members = blds.filter((b) => b.official && b.official.zoneId > 0).map((b) => ({ x: b.cx, z: b.cz, r: Math.sqrt(b.areaM2 / Math.PI), zone: b.official!.zoneId }))
  const cfg = new Map(zonesCfg.map((z) => [z.id, z]))
  for (let j = 0; j < zd; j++)
    for (let i = 0; i < zw; i++) {
      const gx = i * ZS + ZS / 2,
        gz = j * ZS + ZS / 2
      let best = Infinity,
        zone = 0
      for (const m of members) {
        const d = Math.hypot(gx - m.x, gz - m.z) - m.r
        if (d < best) {
          best = d
          zone = m.zone
        }
      }
      const z = cfg.get(zone)
      if (z && z.enabled && best <= z.expandRadiusM * BLOCKS_PER_METRE) zoneGrid[j * zw + i] = zone
    }
  if (stationZone?.enabled && hkuStation) {
    const [sx, sz] = toGrid((hkuStation.geometry as Point).coordinates[0], (hkuStation.geometry as Point).coordinates[1])
    const R = stationZone.expandRadiusM * BLOCKS_PER_METRE
    for (let j = 0; j < zd; j++) for (let i = 0; i < zw; i++) if (Math.hypot(i * ZS + 2 - sx, j * ZS + 2 - sz) <= R) zoneGrid[j * zw + i] = stationZone.id
  }
}
const zoneAt = (gx: number, gz: number) => zoneGrid[Math.min(zd - 1, Math.max(0, Math.floor(gz / ZS))) * zw + Math.min(zw - 1, Math.max(0, Math.floor(gx / ZS)))]
for (const b of blds) if (!b.zoneId) b.zoneId = zoneAt(b.cx, b.cz)

// ───────────────────────── vegetation ─────────────────────────
const hard = new Uint8Array(N),
  soft = new Uint8Array(N)
for (let c = 0; c < N; c++) {
  hard[c] = S.lock[c] >= 2 || S.sea[c] || S.bld[c] || S.sTop[c] ? 1 : 0
  soft[c] = S.lock[c] === 1 ? 1 : 0
}
const dHard = distanceTo(hard, 6),
  dSoft = distanceTo(soft, 4)
const trees: number[] = []
const treeCells = new Uint8Array(N)
function plant(gx: number, gz: number, type: number, size: number, seed: number, strict = true): boolean {
  const i = Math.floor(gx),
    j = Math.floor(gz)
  if (i < 2 || j < 2 || i >= W - 2 || j >= D - 2) return false
  const c = j * W + i
  if (S.lock[c] !== 0 || S.sea[c] || S.bld[c] || S.surf[c] === M.ROCK || S.surf[c] === M.PAVEMENT) return false
  if (dHard[c] < (strict ? 3 : 2) || dSoft[c] < 2) return false
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (treeCells[c + dj * W + di]) return false
  treeCells[c] = 1
  trees.push(Math.floor(gx * 8), S.H[c], Math.floor(gz * 8), type, size, Math.floor(hash2(i, j, seed) * 256), Math.floor(hash2(j, i, seed + 1) * 4))
  return true
}
{
  const STEP = 5
  for (let gj = 2; gj < D - 2; gj += STEP)
    for (let gi = 2; gi < W - 2; gi += STEP) {
      const jx = hash2(gi, gj, 21),
        jz = hash2(gi, gj, 22),
        r = hash2(gi, gj, 23),
        r2 = hash2(gi, gj, 24)
      const gx = gi + jx * (STEP - 0.5),
        gz = gj + jz * (STEP - 0.5)
      const c = Math.floor(gz) * W + Math.floor(gx)
      const cover = S.cover[c]
      const h = S.H[c],
        i = c % W
      const slope = Math.max(Math.abs(h - S.H[i > 0 ? c - 1 : c]), Math.abs(h - S.H[i < W - 1 ? c + 1 : c]), Math.abs(h - S.H[c - W]), Math.abs(h - S.H[c + W]))
      const sp = valueNoise(gx, gz, 70, 77)
      let p: number, type: number, size: number
      if (cover === 1) {
        p = 0.95
        type = sp < 0.36 ? TREE.BROADLEAF : sp < 0.6 ? TREE.BANYAN : sp < 0.84 ? TREE.TALL : TREE.SMALL
        if (r2 < 0.045) type = r2 < 0.01 ? TREE.RED : r2 < 0.02 ? TREE.PINK : r2 < 0.032 ? TREE.YELLOW : TREE.CONIFER
        size = 8 + (Math.floor(r2 * 97) % 6)
      } else if (cover === 2) {
        p = 0.3
        type = TREE.SMALL
        size = 5 + (Math.floor(r2 * 31) % 3)
      } else if (cover === 4) {
        p = 0.32
        type = [TREE.SMALL, TREE.PINK, TREE.YELLOW, TREE.PALM, TREE.BROADLEAF, TREE.RED][Math.floor(r2 * 6)]
        size = 6 + (Math.floor(r2 * 53) % 4)
      } else if (cover === 3 || cover === 5) {
        p = 0.03
        type = TREE.SMALL
        size = 6
      } else {
        p = slope >= 2 ? 0.8 : S.campus[c] ? 0.42 : 0.3
        type = sp < 0.42 ? TREE.BROADLEAF : sp < 0.64 ? TREE.BANYAN : sp < 0.86 ? TREE.TALL : TREE.SMALL
        if (r2 < 0.06) type = r2 < 0.018 ? TREE.PINK : r2 < 0.03 ? TREE.RED : r2 < 0.045 ? TREE.YELLOW : TREE.PALM
        size = 7 + (Math.floor(r2 * 89) % 6)
      }
      if (r < p) plant(gx, gz, type, size, 31)
    }
  for (const f of vegF) {
    if (f.properties.kind === 'tree' && f.geometry.type === 'Point') {
      const [gx, gz] = toGrid((f.geometry as Point).coordinates[0], (f.geometry as Point).coordinates[1])
      plant(gx, gz, hash2(Math.floor(gx), Math.floor(gz), 9) < 0.3 ? TREE.PINK : TREE.BROADLEAF, 8, 33, false)
    } else if (f.properties.kind === 'tree_row' && f.geometry.type === 'LineString') {
      const pts = projectLine((f.geometry as LineString).coordinates),
        len = lineLength(pts)
      const type = [TREE.BROADLEAF, TREE.SMALL, TREE.PINK, TREE.YELLOW, TREE.PALM][strSeed(f.properties.id) % 5]
      for (let s = 2; s < len; s += 7) {
        const [x, z] = pointAlong(pts, s)
        plant(x, z, type, 8, 35, false)
      }
    }
  }
}

// ───────────────────────── props ─────────────────────────
const props: number[] = []
const addProp = (gx: number, gz: number, type: number, rot = 0, a = 0, b = 0) => {
  const i = Math.floor(gx),
    j = Math.floor(gz)
  if (i < 1 || j < 1 || i >= W - 1 || j >= D - 1) return false
  const c = j * W + i
  if (S.sea[c] || S.bld[c] || S.sTop[c]) return false
  props.push(Math.floor(gx * 8), S.H[c], Math.floor(gz * 8), type, rot & 3, a, b)
  return true
}
{
  // street lamps: inferred dressing along campus roads (not surveyed positions)
  for (const w of roadRecs) {
    const hw = w.tags.highway
    if (!hw || !['secondary', 'tertiary', 'unclassified', 'residential', 'service'].includes(hw) || w.len < 30) continue
    let side = strSeed(w.id) % 2 ? 1 : -1
    for (let s = 12; s < w.len - 6; s += 28) {
      const [x, z, tx, tz] = pointAlong(w.pts, s)
      const off = w.spec.half + w.spec.kerb - 0.3
      const gx = x - tz * off * side,
        gz = z + tx * off * side
      const c = Math.floor(gz) * W + Math.floor(gx)
      if (gx > 1 && gz > 1 && gx < W - 1 && gz < D - 1 && S.campus[c] && S.surf[c] !== M.ASPHALT && S.surf[c] !== M.ASPHALT_LINE) addProp(gx, gz, PROP.LAMP, 0)
      side = -side
    }
  }
  // lamps along the main pedestrian routes
  for (const w of pathRecs) {
    if (w.tags.highway !== 'pedestrian' || w.len < 40) continue
    for (let s = 8; s < w.len - 4; s += 24) {
      const [x, z, tx, tz] = pointAlong(w.pts, s)
      addProp(x - tz * (w.spec.half + 0.4), z + tx * (w.spec.half + 0.4), PROP.LAMP, 0)
    }
  }
  // shuttle-bus shelters at official stops (snapped to the nearest non-road cell)
  for (const s of official.stops as { point: { lat: number; lon: number } | null }[]) {
    if (!s.point) continue
    const [gx, gz] = toGrid(s.point.lon, s.point.lat)
    let best: [number, number] | null = null,
      bd = 9
    for (let dj = -8; dj <= 8; dj++)
      for (let di = -8; di <= 8; di++) {
        const i = Math.floor(gx) + di,
          j = Math.floor(gz) + dj
        if (i < 1 || j < 1 || i >= W - 1 || j >= D - 1) continue
        const c = j * W + i
        if (S.lock[c] === 3 || S.bld[c] || S.sea[c] || S.sTop[c] || S.lock[c] === 5) continue
        const d = Math.hypot(di, dj) + (S.surf[c] === M.PAVEMENT ? -1.5 : 0)
        if (d < bd) {
          bd = d
          best = [i + 0.5, j + 0.5]
        }
      }
    if (best) addProp(best[0], best[1], PROP.BUS_SHELTER, Math.floor(hash2(Math.floor(gx), Math.floor(gz), 4) * 4))
  }
  for (const f of terrF)
    if (f.properties.kind === 'fence' && f.geometry.type === 'LineString') {
      const pts = projectLine((f.geometry as LineString).coordinates),
        len = lineLength(pts)
      for (let s = 0; s <= len; s += 2.5) {
        const [x, z, tx] = pointAlong(pts, s)
        addProp(x, z, PROP.FENCE, Math.abs(tx) > 0.7 ? 0 : 1)
      }
    }
  // shrubs, flowers and benches in gardens / scrub
  for (let gj = 2; gj < D - 2; gj += 3)
    for (let gi = 2; gi < W - 2; gi += 3) {
      const r = hash2(gi, gj, 41)
      const gx = gi + hash2(gi, gj, 42) * 2.5,
        gz = gj + hash2(gi, gj, 43) * 2.5
      const c = Math.floor(gz) * W + Math.floor(gx)
      if (S.lock[c] !== 0 || S.sea[c] || treeCells[c] || dHard[c] < 2) continue
      const cover = S.cover[c]
      if (cover === 4 && r < 0.3) addProp(gx, gz, r < 0.1 ? PROP.FLOWER_SHRUB : PROP.SHRUB, Math.floor(r * 40))
      else if (cover === 2 && r < 0.45) addProp(gx, gz, PROP.SHRUB, Math.floor(r * 40))
      else if (cover === 5 && r < 0.5) addProp(gx, gz, PROP.FLOWER_SHRUB, Math.floor(r * 40))
      else if (cover === 0 && S.campus[c] && r < 0.035 && dSoft[c] <= 3) addProp(gx, gz, r < 0.012 ? PROP.FLOWER_SHRUB : PROP.SHRUB, Math.floor(r * 400))
      else if (cover === 4 && r > 0.985 && dSoft[c] === 2) addProp(gx, gz, PROP.BENCH, Math.floor(r * 4000))
    }
}
log(`vegetation: ${trees.length / 7} trees · props: ${props.length / 7}`)

// ───────────────────────── features ─────────────────────────
const features: FeatureRecord[] = []
const wx = (gx: number) => Math.round((gx + WORLD.minX) * 10) / 10
const wz = (gz: number) => Math.round((gz + WORLD.minZ) * 10) / 10
const groundY = (gx: number, gz: number) => {
  const c = Math.min(D - 1, Math.max(0, Math.floor(gz))) * W + Math.min(W - 1, Math.max(0, Math.floor(gx)))
  return Math.max(S.H[c], S.sTop[c]) - Y_BIAS
}
const ll = (gx: number, gz: number) => {
  const p = worldToLonLat(gx + WORLD.minX, gz + WORLD.minZ)
  return { lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 }
}
for (const b of blds) {
  const o = b.official
  const name = b.nameEn || b.nameZh || b.derivedName || (b.category === 'canopy' ? 'Covered structure' : 'Unnamed building')
  const rank = b.tier === 'A' ? 95 : o ? (o.shortCode ? 85 : 80) : b.tier === 'B' ? 60 : b.nameEn || b.nameZh ? 14 : b.derivedName ? 8 : 4
  const alt = [...b.aliases.flatMap((a) => [a.nameEn, a.nameZh, a.mapCode, a.shortCode]), ...(b.aliasNames ?? []), b.tags.alt_name, b.tags['alt_name:en'], b.landmark?.title].filter(
    (x): x is string => !!x,
  )
  features.push({
    i: b.idx,
    key: b.id,
    kind: 'building',
    name,
    nameZh: b.nameZh || undefined,
    code: o?.mapCode || undefined,
    short: o?.shortCode || undefined,
    zone: b.zoneId,
    category: b.category,
    tier: b.tier,
    x: wx(b.cx),
    y: b.top - Y_BIAS,
    z: wz(b.cz),
    bbox: [wx(b.i0), wz(b.j0), wx(b.i1 + 1), wz(b.j1 + 1)],
    ...ll(b.cx, b.cz),
    levels: b.levels,
    heightM: b.heightM,
    heightSource: b.heightSource,
    heightConfidence: b.heightConfidence,
    geom: b.geom,
    nameSource: b.matchMethod ?? (b.nameFrom === 'landsd' ? 'landsd' : b.nameEn || b.nameZh ? 'osm' : b.derivedName ? 'derived-street' : 'none'),
    osm: b.id,
    official: !!o || !!b.matchMethod,
    notes: b.notes.join(' ') || undefined,
    rank,
    alt: alt.length ? alt : undefined,
  })
}
const pushPoint = (rec: Omit<FeatureRecord, 'i' | 'x' | 'y' | 'z' | 'lat' | 'lon'>, lon: number, lat: number): boolean => {
  const [gx, gz] = toGrid(lon, lat)
  if (gx < 0 || gz < 0 || gx >= W || gz >= D) return false
  features.push({ ...rec, i: features.length + 1, x: wx(gx), y: groundY(gx, gz), z: wz(gz), lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 })
  return true
}
for (const l of official.landmarks as { officialId: number; nameEn: string; nameZh: string; zoneId: number; point: { lat: number; lon: number } | null }[]) {
  if (l.point && !mergedLandmarks.has(l.nameEn))
    pushPoint(
      {
        key: `official-landmark/${l.officialId}`,
        kind: 'landmark',
        name: l.nameEn,
        nameZh: l.nameZh,
        zone: l.zoneId,
        category: 'Landmark',
        geom: 'inferred',
        nameSource: 'official-point',
        official: true,
        rank: 90,
        notes: 'Position is the point published on the official HKU Campus Map.',
      },
      l.point.lon,
      l.point.lat,
    )
}
for (const s of official.stops as { officialId: number; nameEn: string; nameZh: string; point: { lat: number; lon: number } | null }[]) {
  if (s.point)
    pushPoint(
      {
        key: `official-stop/${s.officialId}`,
        kind: 'stop',
        name: `${s.nameEn} (shuttle bus stop)`,
        nameZh: s.nameZh,
        zone: 0,
        category: 'Shuttle bus stop',
        geom: 'inferred',
        nameSource: 'official-point',
        official: true,
        rank: 45,
        notes: 'Stop position from the official HKU Campus Map; shelter model is generic.',
      },
      s.point.lon,
      s.point.lat,
    )
}
{
  const seen = new Set<string>()
  for (const f of official.facilities as { officialId: number; nameEn: string; nameZh: string; type: string; point: { lat: number; lon: number } }[]) {
    const k = `${norm(f.nameEn)}@${f.point.lat.toFixed(4)},${f.point.lon.toFixed(4)}`
    if (!f.nameEn || seen.has(k)) continue
    seen.add(k)
    pushPoint(
      {
        key: `official-facility/${f.officialId}`,
        kind: 'facility',
        name: f.nameEn,
        nameZh: f.nameZh || undefined,
        zone: 0,
        category: f.type,
        geom: 'inferred',
        nameSource: 'official-point',
        official: true,
        rank: 40,
      },
      f.point.lon,
      f.point.lat,
    )
  }
  if (hkuStation)
    pushPoint(
      {
        key: hkuStation.properties.id,
        kind: 'landmark',
        name: 'HKU Station (MTR Island Line)',
        nameZh: '香港大學站',
        zone: stationZone?.id ?? 0,
        category: 'Railway station (underground)',
        geom: 'inferred',
        nameSource: 'osm',
        osm: hkuStation.properties.id,
        rank: 92,
        alt: ['MTR', 'HKU MTR Station', '港鐵香港大學站'],
        notes: 'The station is underground; only its position and street exits are shown.',
      },
      (hkuStation.geometry as Point).coordinates[0],
      (hkuStation.geometry as Point).coordinates[1],
    )
  // street exits of HKU Station (exits of neighbouring stations are left out)
  for (const f of transF) {
    if (f.properties.kind !== 'subway_entrance' || f.geometry.type !== 'Point' || !hkuStation) continue
    const [lon, lat] = (f.geometry as Point).coordinates
    const [gx, gz] = toGrid(lon, lat)
    let nearest = hkuStation,
      nd = Infinity
    for (const st of stationNodes) {
      const [sx, sz] = toGrid((st.geometry as Point).coordinates[0], (st.geometry as Point).coordinates[1])
      const d = Math.hypot(sx - gx, sz - gz)
      if (d < nd) {
        nd = d
        nearest = st
      }
    }
    if (nearest !== hkuStation || nd > 420) continue
    const t = f.properties.tags
    const en = t['name:en'] ?? (t.name ?? '').replace(/[\u3400-\u9fff]+/g, '').trim()
    const zh = t['name:zh'] ?? ((t.name ?? '').match(/[\u3400-\u9fff]+/g) ?? []).join('')
    pushPoint(
      {
        key: f.properties.id,
        kind: 'stop',
        name: `HKU Station Exit ${t.ref ?? ''}${en ? ` (${en})` : ''}`.replace(/\s+/g, ' ').trim(),
        nameZh: zh ? `香港大學站 ${t.ref ?? ''} 出口（${zh}）` : undefined,
        zone: 0,
        category: 'MTR exit',
        geom: 'inferred',
        nameSource: 'osm',
        osm: f.properties.id,
        rank: 46,
      },
      lon,
      lat,
    )
  }
  // official locations with no footprint in the map data are still listed, as points
  for (const o of unmatchedOfficial) {
    if (!o.point) continue
    pushPoint(
      {
        key: `official-location/${o.officialId}`,
        kind: 'landmark',
        name: o.nameEn,
        nameZh: o.nameZh || undefined,
        short: o.shortCode || undefined,
        zone: o.zoneId,
        category: 'Official location (no footprint in map data)',
        geom: 'inferred',
        nameSource: 'official-point',
        official: true,
        rank: 72,
        notes: 'Listed on the official HKU Campus Map but without a matching building footprint in OpenStreetMap; shown at the official map point only.',
      },
      o.point.lon,
      o.point.lat,
    )
  }
  for (const f of facF) {
    const t = f.properties.tags
    if (f.geometry.type !== 'Point' || !['artwork', 'viewpoint', 'museum'].includes(f.properties.kind) || !(t['name:en'] ?? t.name)) continue
    pushPoint(
      {
        key: f.properties.id,
        kind: 'facility',
        name: t['name:en'] ?? t.name,
        nameZh: t['name:zh'],
        zone: 0,
        category: f.properties.kind === 'artwork' ? 'Artwork' : f.properties.kind === 'viewpoint' ? 'Viewpoint' : 'Museum',
        geom: 'inferred',
        nameSource: 'osm',
        osm: f.properties.id,
        rank: 38,
      },
      (f.geometry as Point).coordinates[0],
      (f.geometry as Point).coordinates[1],
    )
  }
  // named roads
  const byName = new Map<string, { len: number; f: F; zh?: string }>()
  for (const f of [...roadsF, ...bridgesF]) {
    const t = f.properties.tags
    const n = t['name:en'] ?? (t.name && /[a-zA-Z]/.test(t.name) ? t.name.replace(/[㐀-鿿]+/g, '').trim() : '')
    if (!n || f.geometry.type !== 'LineString' || !t.highway) continue
    const len = lineLength(projectLine((f.geometry as LineString).coordinates))
    const cur = byName.get(n)
    if (!cur || len > cur.len) byName.set(n, { len, f, zh: t['name:zh'] ?? cur?.zh })
  }
  for (const [n, { f, zh }] of byName) {
    const pts = projectLine((f.geometry as LineString).coordinates)
    const [gx, gz] = pointAlong(pts, lineLength(pts) / 2)
    const p = worldToLonLat(gx + WORLD.minX, gz + WORLD.minZ)
    pushPoint({ key: `road/${f.properties.id}`, kind: 'road', name: n, nameZh: zh, zone: 0, category: 'Road', geom: 'inferred', nameSource: 'osm', osm: f.properties.id, rank: 35 }, p.lon, p.lat)
  }
}
for (const f of features)
  if (!f.zone && f.kind !== 'building') {
    f.zone = zoneAt(f.x - WORLD.minX, f.z - WORLD.minZ)
  }
const zones: ZoneInfo[] = zonesCfg.map((z) => {
  const off = (official.zones as { id: number; point: { lat: number; lon: number } | null }[]).find((q) => q.id === z.id)
  const members = blds.filter((b) => b.zoneId === z.id && b.official)
  let gx = 0,
    gz = 0,
    n = 0
  for (let j = 0; j < zd; j++)
    for (let i = 0; i < zw; i++)
      if (zoneGrid[j * zw + i] === z.id) {
        gx += i * ZS + 2
        gz += j * ZS + 2
        n++
      }
  if (off?.point) [gx, gz] = toGrid(off.point.lon, off.point.lat)
  else if (n) {
    gx /= n
    gz /= n
  }
  const info: ZoneInfo = {
    id: z.id,
    nameEn: z.nameEn,
    nameZh: z.nameZh,
    colour: ZONE_COLOURS[z.id],
    enabled: z.enabled && n > 0,
    source: z.source,
    x: wx(gx),
    y: groundY(gx, gz) + 28,
    z: wz(gz),
    buildingCount: members.length,
  }
  if (info.enabled)
    features.push({
      i: features.length + 1,
      key: `zone/${z.id}`,
      kind: 'zone',
      name: z.nameEn,
      nameZh: z.nameZh,
      zone: z.id,
      category: 'Campus zone',
      x: info.x,
      y: info.y - 28,
      z: info.z,
      ...ll(gx, gz),
      geom: 'inferred',
      nameSource: z.source === 'official-campus-id' ? 'official-name' : 'derived',
      official: z.source === 'official-campus-id',
      rank: 100,
      notes: 'Zone extent is derived from the official building list (nearest official building), not a surveyed boundary.',
    })
  return info
})

// ───────────────────────── write ─────────────────────────
mkdirSync(OUT, { recursive: true })
const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
const heightDelta = new Uint16Array(N)
for (let j = 0; j < D; j++)
  for (let i = 0; i < W; i++) {
    const c = j * W + i
    heightDelta[c] = (S.H[c] - (i ? S.H[c - 1] : 0)) & 0xffff
  }
const columns = gzipSync(Buffer.concat([u8(heightDelta), u8(S.surf), u8(S.sBot), u8(S.sTop), u8(S.sFeat), u8(zoneGrid)]), { level: 9 })
writeFileSync(resolve(OUT, 'columns.bin'), columns)

const groups: StructureGroup[] = []
const parts: { origin: Uint16Array; quad: Uint8Array; feature: Uint16Array }[] = []
let quadCount = 0
for (const k of [...sinks.keys()].sort((a, b) => a - b)) {
  const t = sinks.get(k)!.trimmed()
  if (!t.count) continue
  const min: [number, number, number] = [65535, 65535, 65535],
    max: [number, number, number] = [0, 0, 0]
  for (let q = 0; q < t.count; q++) {
    const du = t.quad[q * 4],
      dv = t.quad[q * 4 + 1],
      dir = t.quad[q * 4 + 2]
    const ext = dir < 2 ? [0, dv, du] : dir < 4 ? [du, 0, dv] : [du, dv, 0]
    for (let a = 0; a < 3; a++) {
      const v = t.origin[q * 3 + a]
      min[a] = Math.min(min[a], v)
      max[a] = Math.max(max[a], v + ext[a])
    }
  }
  groups.push({ cx: k % 64, cz: Math.floor(k / 64), start: quadCount, count: t.count, min, max })
  parts.push({ origin: t.origin, quad: t.quad, feature: t.feature! })
  quadCount += t.count
}
const structures = gzipSync(Buffer.concat([...parts.map((p) => u8(p.origin)), ...parts.map((p) => u8(p.quad)), ...parts.map((p) => u8(p.feature))]), { level: 9 })
writeFileSync(resolve(OUT, 'structures.bin'), structures)

function packRecords(flat: number[], stride: number): Buffer {
  const n = flat.length / 7
  const buf = Buffer.alloc(n * stride)
  for (let k = 0; k < n; k++) {
    buf.writeUInt16LE(Math.min(65535, flat[k * 7]), k * stride)
    buf.writeUInt16LE(flat[k * 7 + 1], k * stride + 2)
    buf.writeUInt16LE(Math.min(65535, flat[k * 7 + 2]), k * stride + 4)
    for (let q = 0; q < 4; q++) buf[k * stride + 6 + q] = flat[k * 7 + 3 + q] & 255
  }
  return buf
}
const treesBin = gzipSync(packRecords(trees, TREE_STRIDE), { level: 9 })
const propsBin = gzipSync(packRecords(props, PROP_STRIDE), { level: 9 })
writeFileSync(resolve(OUT, 'trees.bin'), treesBin)
writeFileSync(resolve(OUT, 'props.bin'), propsBin)
writeFileSync(resolve(OUT, 'features.json'), JSON.stringify(features))

const count = (pred: (b: Bld) => boolean) => blds.filter(pred).length
const meta: WorldMeta = {
  version: 1,
  generatedAt: new Date().toISOString(),
  anchor: { ...ANCHOR },
  blocksPerMetre: BLOCKS_PER_METRE,
  world: { ...WORLD },
  yBias: Y_BIAS,
  seaLevel: SEA_LEVEL,
  columns: { file: 'columns.bin', bytes: columns.length },
  structures: { file: 'structures.bin', quadCount, groups },
  trees: { file: 'trees.bin', count: trees.length / 7 },
  props: { file: 'props.bin', count: props.length / 7 },
  zoneGrid: { scale: ZS, w: zw, d: zd },
  zones,
  stats: {
    buildings: blds.length,
    tierA: count((b) => b.tier === 'A'),
    tierB: count((b) => b.tier === 'B'),
    tierC: count((b) => b.tier === 'C'),
    officialBuildings: officialHere.length,
    officialMatched: matchReport.filter((m) => m.method !== 'unmatched').length,
    geomVerified: count((b) => b.geom === 'verified'),
    geomInferred: count((b) => b.geom === 'inferred'),
    geomApproximate: count((b) => b.geom === 'approximate'),
    features: features.length,
    trees: trees.length / 7,
    props: props.length / 7,
    structureQuads: quadCount,
    maxTerrainM: maxH - Y_BIAS,
    roadWays: roadRecs.length,
    pathWays: pathRecs.length,
    bridgeWays: bridgeRecs.length,
  },
  sources: { osmBase: osmMeta.osmBase ?? null, osmFetchedAt: osmMeta.fetchedAt ?? null, terrain: 'Lands Department 5 m DTM (DATA.GOV.HK)', official: official.metadata.url },
}
writeFileSync(resolve(OUT, 'world.json'), JSON.stringify(meta))
writeFileSync(
  resolve(ROOT, 'data/processed/build-report.json'),
  JSON.stringify(
    {
      generatedAt: meta.generatedAt,
      stats: meta.stats,
      officialMatches: matchReport,
      specials,
      tierA: blds.filter((b) => b.tier === 'A').map((b) => ({ id: b.id, name: b.nameEn, model: b.landmark?.model, base: b.base - Y_BIAS, heightM: b.heightM, heightSource: b.heightSource })),
    },
    null,
    1,
  ),
)
const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`
log(
  `written: columns ${kb(columns.length)} · structures ${kb(structures.length)} (${quadCount} quads, ${groups.length} groups) · trees ${kb(treesBin.length)} · props ${kb(propsBin.length)} · ${features.length} features`,
)
const un = matchReport.filter((m) => m.method === 'unmatched')
if (un.length) log('official buildings without an OSM footprint:', un.map((m) => `${m.code} ${m.name}`).join('; '))
