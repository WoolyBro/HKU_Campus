/**
 * fetch-hk-monuments.ts — Hong Kong's declared monuments (Antiquities and Monuments Office,
 * "Declared Monuments with Images", CSDI portal WFS; DATA.GOV.HK terms). Each monument inside the
 * study area is kept with its name, declaration year and the centre of its outline, and merged into
 * data/processed/guide-facts.json as `monuments` (matched to buildings by position at build time).
 * Usage: npx tsx scripts/fetch-hk-monuments.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studyAreaRing } from '../src/lib/geo/projection'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'data/processed/guide-facts.json')
const WFS = 'https://portal.csdi.gov.hk/server/services/common/devb_wb_rcd_1639040299687_46105/MapServer/WFSServer'
const caps = await (await fetch(`${WFS}?service=WFS&version=2.0.0&request=GetCapabilities`)).text()
const type = /<wfs:Name>([^<]+)<\/wfs:Name>/.exec(caps)?.[1]
if (!type) throw new Error('declared monuments: no feature type in the WFS capabilities')
const res = await fetch(`${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(type)}&outputFormat=geojson`)
if (!res.ok) throw new Error(`declared monuments: HTTP ${res.status}`)
const gj = (await res.json()) as { features: { geometry: { type: string; coordinates: number[][][] | number[][][][] }; properties: Record<string, string | number> }[] }
const ring = studyAreaRing(0)
const lons = ring.map((p) => p[0])
const lats = ring.map((p) => p[1])
const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
const monuments: { name: string; nameZh: string; status: string; year: number; lat: number; lon: number; source: string; url: string }[] = []
for (const f of gj.features) {
  const pts = (f.geometry.type === 'MultiPolygon' ? (f.geometry.coordinates as number[][][][]).flat(2) : (f.geometry.coordinates as number[][][]).flat()) as unknown as number[][]
  if (!pts.length) continue
  const lon = pts.reduce((a, p) => a + p[0], 0) / pts.length,
    lat = pts.reduce((a, p) => a + p[1], 0) / pts.length
  if (!(lon >= w && lon <= e && lat >= s && lat <= n)) continue
  const p = f.properties
  monuments.push({
    name: String(p.NAME),
    nameZh: String(p.NAME_TC ?? ''),
    status: `Declared monument (Antiquities and Monuments Ordinance), declared ${p.DEC_YEAR}`,
    year: Number(p.DEC_YEAR),
    lat: +lat.toFixed(6),
    lon: +lon.toFixed(6),
    source: 'Antiquities and Monuments Office',
    url: String(p.DETAIL ?? ''),
  })
}
const prev = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>) : { wikidata: [] }
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  JSON.stringify({ ...prev, sources: { ...((prev.sources as object) ?? {}), monuments: 'Antiquities and Monuments Office, Declared Monuments (CSDI / DATA.GOV.HK)' }, monuments }, null, 1),
)
console.log(`declared monuments: ${monuments.length} in the study area (${gj.features.length} in Hong Kong)`)
