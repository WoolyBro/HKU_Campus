/**
 * fetch-official.ts — caches the location data behind the official HKU Campus Map
 * (https://www.maps.hku.hk/) and extracts the factual fields this project relies on: official
 * names (EN/ZH), building codes, campus grouping, map points and facility names.
 *
 * © The University of Hong Kong. No open licence is stated for this data, so the raw responses
 * stay in data/raw/ (git-ignored) and only names / codes / campus ids / points are carried into
 * data/processed/official-hku.json, with attribution. Contact details and photographs published
 * with the map are deliberately NOT extracted. See docs/DATA_SOURCES.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAW_DIR = resolve(ROOT, 'data/raw/hku')
const RAW = resolve(RAW_DIR, 'locations.json')
const OUT = resolve(ROOT, 'data/processed/official-hku.json')
const BASE = 'https://www.maps.hku.hk/'
const UA = 'hku-voxel-campus-build/0.1 (one-off static data extract)'
const force = process.argv.includes('--force')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface RawFacility {
  id: string
  name_en: string
  name_zh_hant: string
  facility_type_id: string
  lat: string
  lng: string
}
interface RawLocation {
  id: string
  code: string | null
  name_en: string
  name_zh_hant: string
  lat: string
  lng: string
  location_type_id: string
  campus_id: string
  facilities?: RawFacility[]
}
interface RawCache {
  fetchedAt: string
  sections: Record<string, string>
  facilityTypes: Record<string, string>
  records: RawLocation[]
}

async function get(path: string): Promise<string> {
  let last: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
      return (await res.text()).replace(/^\uFEFF/, '')
    } catch (err) {
      last = err
      await sleep(2000 * (attempt + 1)) // transient time-outs: back off and retry
    }
  }
  throw new Error(`${path}: ${String(last)}`)
}
const unescape = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

async function download(): Promise<RawCache> {
  console.log('official: reading the HKU Campus Map location list')
  const html = await get('')
  // building list: section headers (campus groups) followed by location ids
  const start = html.indexOf('<ul id="buildinglist"')
  const end = html.indexOf('navitemlist', start + 10)
  const block = html.slice(start, end > 0 ? end : start + 80_000)
  const sections: Record<string, string> = {}
  let section = ''
  for (const m of block.matchAll(/<ul class="navmenusectionheader">(.*?)<\/ul>|fetchMapPoint\((\d+),'Locations'\)/gs)) {
    if (m[1] !== undefined) section = unescape(m[1])
    else sections[m[2]] = section
  }
  const facilityTypes: Record<string, string> = {}
  const fl = html.slice(html.indexOf('<ul id="facilitylist"'), html.indexOf('<ul id="facilitylist"') + 30_000)
  for (const m of fl.matchAll(/value="(\d+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]+)/g)) facilityTypes[m[1]] = unescape(m[2])
  // the overview also contains gates that are not in the building list
  const overview = JSON.parse(await get('getlocationjson.php?type=Locations')) as { records: RawLocation[] }
  const ids = new Set<string>([...Object.keys(sections), ...overview.records.map((r) => r.id)])
  const records: RawLocation[] = []
  let n = 0
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b))) {
    const json = JSON.parse(await get(`getlocationjson.php?type=Locations&id=${id}`)) as { records: RawLocation[] }
    if (json.records?.[0]) records.push(json.records[0])
    if (++n % 20 === 0) console.log(`official: ${n}/${ids.size} locations`)
    await sleep(250) // be polite: one small request at a time
  }
  return { fetchedAt: new Date().toISOString(), sections, facilityTypes, records }
}

mkdirSync(RAW_DIR, { recursive: true })
mkdirSync(dirname(OUT), { recursive: true })
let cache: RawCache
if (existsSync(RAW) && !force) {
  console.log('official: using cached data/raw/hku/locations.json')
  cache = JSON.parse(readFileSync(RAW, 'utf8'))
} else {
  cache = await download()
  writeFileSync(RAW, JSON.stringify(cache))
}

const zonesCfg = JSON.parse(readFileSync(resolve(ROOT, 'data/campus-zones.json'), 'utf8')) as {
  placeIds: number[]
  zones: { id: number; nameEn: string; nameZh: string; source: string; officialCampusId?: number; officialIds?: number[] }[]
}
const latLng = (lat: string, lng: string) => {
  const a = Number(lat),
    b = Number(lng)
  return a > 22 && a < 23 && b > 113.8 && b < 114.5 ? { lat: a, lon: b } : null
}
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
function zoneOf(r: RawLocation): number {
  const id = Number(r.id)
  for (const z of zonesCfg.zones) if (z.officialIds?.includes(id)) return z.id
  for (const z of zonesCfg.zones) if (z.source === 'official-campus-id' && z.officialCampusId === Number(r.campus_id)) return z.id
  return 0
}
const hallZone = zonesCfg.zones.find((z) => z.nameEn.startsWith('Residential'))?.id ?? -1
const places = new Set(zonesCfg.placeIds)

const all = cache.records.filter((r) => latLng(r.lat, r.lng) || clean(r.name_en))
const buildings = all
  .filter((r) => !places.has(Number(r.id)) && r.location_type_id !== '3')
  .map((r) => ({
    officialId: Number(r.id),
    mapCode: '',
    shortCode: clean(r.code),
    nameEn: clean(r.name_en),
    nameZh: clean(r.name_zh_hant),
    zoneId: zoneOf(r),
    hostelType: zoneOf(r) === hallZone ? 1 : null,
    campusGroup: cache.sections[r.id] ?? '',
    point: latLng(r.lat, r.lng),
  }))
const landmarks = all
  .filter((r) => places.has(Number(r.id)) || r.location_type_id === '3')
  .map((r) => ({ officialId: Number(r.id), nameEn: clean(r.name_en), nameZh: clean(r.name_zh_hant), zoneId: zoneOf(r), point: latLng(r.lat, r.lng) }))
const facilities = all.flatMap((r) =>
  (r.facilities ?? [])
    .filter((f) => clean(f.name_en))
    .map((f) => ({
      officialId: Number(f.id),
      buildingId: Number(r.id),
      nameEn: clean(f.name_en),
      nameZh: clean(f.name_zh_hant),
      type: (cache.facilityTypes[f.facility_type_id] ?? '').length && (cache.facilityTypes[f.facility_type_id] ?? '').length < 60 ? cache.facilityTypes[f.facility_type_id] : 'Facility',
      point: latLng(f.lat, f.lng) ?? latLng(r.lat, r.lng),
    }))
    .filter((f) => f.point),
)
const zones = zonesCfg.zones.map((z) => ({ id: z.id, nameEn: z.nameEn, nameZh: z.nameZh, point: null }))

writeFileSync(
  OUT,
  JSON.stringify(
    {
      metadata: {
        source: 'Official HKU Campus Map location data',
        url: BASE,
        rights: '© The University of Hong Kong. Factual names, codes and points only; used with attribution. Not an open-licensed dataset.',
        note: 'Centennial Campus / halls / western-site grouping is a project grouping of official locations (see data/campus-zones.json).',
        fetchedAt: cache.fetchedAt,
        extractedAt: new Date().toISOString(),
      },
      zones,
      hostelTypes: { 1: 'Residential hall / college' },
      buildings,
      landmarks,
      stops: [],
      facilities,
    },
    null,
    1,
  ),
)
console.log(`official: ${zones.length} zones, ${buildings.length} buildings, ${landmarks.length} places, ${facilities.length} facilities · facility types: ${Object.keys(cache.facilityTypes).length}`)
