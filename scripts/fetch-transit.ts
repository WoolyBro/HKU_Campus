/**
 * fetch-transit-hk.ts — official public-transport stops and routes from the Transport Department's
 * GTFS feed (DATA.GOV.HK, "Public transport — GTFS", English): franchised buses (KMB, Citybus…),
 * green minibuses, trams and ferries. The MTR is not in this feed; stations come from OpenStreetMap.
 *
 * For each stop inside the study area: a cleaned name, position and the routes calling there.
 * The feed is cached in data/raw/gtfs/ (git-ignored). Output: data/processed/transit.json
 * Usage: npx tsx scripts/fetch-transit-hk.ts
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { studyAreaRing } from '../src/lib/geo/projection'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, 'data/raw/gtfs')
const OUT = resolve(ROOT, 'data/processed/transit.json')
const URL = 'https://static.data.gov.hk/td/pt-headway-en/gtfs.zip'

if (!existsSync(resolve(DIR, 'stops.txt'))) {
  mkdirSync(DIR, { recursive: true })
  const zip = resolve(DIR, 'gtfs.zip')
  if (!existsSync(zip)) {
    console.log('transit: downloading the TD GTFS feed …')
    const res = await fetch(URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
  }
  execFileSync('unzip', ['-o', '-q', zip, '-d', DIR])
}
function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = '',
    q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}
async function eachRow(file: string, fn: (r: Record<string, string>) => void) {
  const rl = createInterface({ input: createReadStream(resolve(DIR, file)) })
  let head: string[] | null = null
  for await (const raw of rl) {
    const line = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    if (!line) continue
    const cells = splitCsv(line)
    if (!head) {
      head = cells.map((h) => h.trim())
      continue
    }
    const row: Record<string, string> = {}
    head.forEach((h, k) => (row[h] = (cells[k] ?? '').trim()))
    fn(row)
  }
}
/** "[KMB+CTB] HKU WEST GATE/<BR>…|[CTB] …" → "HKU West Gate" */
const SMALL = new Set(['of', 'and', 'the', 'at', 'on', 'to', 'in'])
function cleanName(raw: string): string {
  const first = raw
    .split('|')[0]
    .replace(/^\[[^\]]*\]\s*/, '')
    .split('/<BR>')[0]
    .trim()
  return first
    .toLowerCase()
    .split(/(\s+|-|\/|\(|\))/)
    .map((w, k) =>
      /^(hku|hkust|mtr|ust|hk|tvb|kmb|ctb|nlb|gmb|bbi|ymca|ywca|ii|iii|iv)$/.test(w) || /^([a-z]\.){2,}$/.test(w) || /^([a-z]\.)+[a-z]$/.test(w)
        ? w.toUpperCase()
        : k > 0 && SMALL.has(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join('')
}
const ring = studyAreaRing(0)
const lons = ring.map((p) => p[0])
const lats = ring.map((p) => p[1])
const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
const stops = new Map<string, { id: string; name: string; lat: number; lon: number; routes: Set<string> }>()
await eachRow('stops.txt', (r) => {
  const lat = Number(r.stop_lat),
    lon = Number(r.stop_lon)
  if (lat >= s && lat <= n && lon >= w && lon <= e) stops.set(r.stop_id, { id: r.stop_id, name: cleanName(r.stop_name), lat, lon, routes: new Set() })
})
const agencies = new Map<string, string>()
await eachRow('agency.txt', (r) => agencies.set(r.agency_id, r.agency_name))
const routes = new Map<string, { short: string; long: string; type: number; agency: string }>()
await eachRow('routes.txt', (r) => routes.set(r.route_id, { short: r.route_short_name, long: r.route_long_name, type: Number(r.route_type), agency: r.agency_id }))
const tripRoute = new Map<string, string>()
await eachRow('trips.txt', (r) => tripRoute.set(r.trip_id, r.route_id))
await eachRow('stop_times.txt', (r) => {
  const st = stops.get(r.stop_id)
  if (!st) return
  const route = tripRoute.get(r.trip_id)
  if (route) st.routes.add(route)
})
const MODE: Record<number, string> = { 0: 'tram', 3: 'bus', 4: 'ferry', 7: 'tram' }
const out = [...stops.values()]
  .filter((st) => st.routes.size)
  .map((st) => ({
    id: st.id,
    code: '',
    name: st.name,
    lat: +st.lat.toFixed(6),
    lon: +st.lon.toFixed(6),
    routes: [
      ...new Map(
        [...st.routes]
          .map((rid) => routes.get(rid)!)
          .filter(Boolean)
          .map((r) => [`${r.agency}:${r.short}`, r]),
      ).values(),
    ]
      .sort((a, b) => a.short.localeCompare(b.short, 'en', { numeric: true }))
      .map((r) => ({ short: r.short, long: `${cleanName(r.long)} (${(agencies.get(r.agency) ?? r.agency).split('|')[0]})`, mode: r.agency === 'GMB' ? 'minibus' : (MODE[r.type] ?? 'bus') })),
  }))
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  JSON.stringify({ agency: 'TD', label: 'bus / minibus stop', source: URL, licence: 'DATA.GOV.HK Terms and Conditions of Use', generatedAt: new Date().toISOString(), stops: out }, null, 1),
)
console.log(`transit: ${out.length} stops in the study area, ${new Set(out.flatMap((x) => x.routes.map((r) => r.short))).size} routes`)
