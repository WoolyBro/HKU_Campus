/**
 * fetch-landsd-buildings.ts — one-off extract of the Lands Department "Building" dataset
 * (CSDI portal, dataset landsd_rcd_1637211194312_35158) for the study area.
 *
 * It supplies what OpenStreetMap often lacks here: official building names (English / Chinese),
 * base and top heights in metres above HKPD, storeys and the podium / tower split.
 * Open data under the DATA.GOV.HK / CSDI terms of use (attribution required).
 * The raw response is cached in data/raw/landsd/ (git-ignored); the website never calls the service.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studyAreaRing } from '../src/lib/geo/projection'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = resolve(ROOT, 'data/raw/landsd')
const OUT = resolve(DIR, 'buildings.json')
const WFS = 'https://portal.csdi.gov.hk/server/services/common/landsd_rcd_1637211194312_35158/MapServer/WFSServer'
const UA = 'hku-voxel-campus-build/0.1 (one-off static data extract)'
const force = process.argv.includes('--force')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

mkdirSync(DIR, { recursive: true })
if (existsSync(OUT) && !force) {
  console.log('landsd buildings: data/raw/landsd/buildings.json already cached (use --force to refresh)')
} else {
  const ring = studyAreaRing(20)
  const lons = ring.map((p) => p[0]),
    lats = ring.map((p) => p[1])
  // this service expects latitude,longitude order with the EPSG:4326 URN
  const bbox = `${Math.min(...lats).toFixed(6)},${Math.min(...lons).toFixed(6)},${Math.max(...lats).toFixed(6)},${Math.max(...lons).toFixed(6)},urn:ogc:def:crs:EPSG::4326`
  const PAGE = 1000
  const features: unknown[] = []
  for (let start = 0; ; start += PAGE) {
    const url = `${WFS}?service=wfs&version=2.0.0&request=GetFeature&typenames=csdi:Building&outputFormat=GEOJSON&srsName=EPSG:4326&bbox=${bbox}&count=${PAGE}&startIndex=${start}`
    let page: { features: unknown[] } | null = null
    for (let attempt = 0; attempt < 4 && !page; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        page = (await res.json()) as { features: unknown[] }
      } catch (err) {
        console.warn(`  page ${start}: ${(err as Error).message}; retrying`)
        await sleep(3000 * (attempt + 1))
      }
    }
    if (!page) throw new Error('Lands Department building service did not respond')
    features.push(...page.features)
    console.log(`landsd buildings: ${features.length} polygons`)
    if (page.features.length < PAGE) break
    await sleep(500)
  }
  writeFileSync(
    OUT,
    JSON.stringify({
      metadata: {
        source: 'Lands Department, HKSAR Government — Building (CSDI dataset landsd_rcd_1637211194312_35158)',
        url: 'https://data.gov.hk/en-data/dataset/hk-landsd-openmap-landsd-building',
        licence: 'DATA.GOV.HK Terms and Conditions of Use',
        fetchedAt: new Date().toISOString(),
        bbox,
      },
      type: 'FeatureCollection',
      features,
    }),
  )
  console.log(`landsd buildings: saved ${features.length} polygons`)
}

// Slim, committed copy used by the world builder: geometry plus the few attributes it needs.
interface RawFeature {
  geometry: { type: string; coordinates: number[][][][] }
  properties: {
    BuildingCSUID: string
    BuildingBlockType: string
    BuildingNameEN: string | null
    BuildingNameTC: string | null
    BaseHeight: number | null
    TopHeight: number | null
    Storeys: number | null
  }
}
const raw = JSON.parse(readFileSync(OUT, 'utf8')) as { metadata: Record<string, string>; features: RawFeature[] }
const round = (n: number) => Math.round(n * 1e7) / 1e7
const slim = raw.features
  .filter((f) => f.geometry?.type === 'MultiPolygon')
  .map((f) => ({
    type: 'Feature',
    properties: {
      id: f.properties.BuildingCSUID,
      type: f.properties.BuildingBlockType,
      nameEn: (f.properties.BuildingNameEN ?? '').trim(),
      nameZh: (f.properties.BuildingNameTC ?? '').trim(),
      base: f.properties.BaseHeight,
      top: f.properties.TopHeight,
      storeys: f.properties.Storeys,
    },
    geometry: { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)]))) },
  }))
mkdirSync(resolve(ROOT, 'data/processed'), { recursive: true })
writeFileSync(
  resolve(ROOT, 'data/processed/landsd-buildings.geojson'),
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: { ...raw.metadata, attribution: 'Building data © The Government of the Hong Kong SAR (Lands Department), from DATA.GOV.HK / CSDI' },
    features: slim,
  }),
)
console.log(`landsd buildings: wrote data/processed/landsd-buildings.geojson (${slim.length} polygons)`)
