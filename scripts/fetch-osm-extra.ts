/**
 * fetch-osm-extra.ts — a supplementary OpenStreetMap extract for the student guide: shops, emergency
 * points (help phones, defibrillators), healthcare and offices inside the study area. The main
 * extract is left untouched, so the model's snapshot stays the same; process-osm merges both.
 *
 * Output: data/raw/osm-extra.json (+ .meta.json)
 * Usage: npx tsx scripts/fetch-osm-extra.ts [--force]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studyAreaRing } from '../src/lib/geo/projection'
import { overpass, polyFilter } from './lib/overpass'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'data/raw/osm-extra.json')
if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log('osm extra: cached; use --force to refresh')
} else {
  const p = polyFilter(studyAreaRing(30))
  const query = `[out:json][timeout:180];(node["shop"]${p};node["emergency"]${p};node["healthcare"]${p};node["office"]${p};way["shop"]${p};way["healthcare"]${p};);out geom;`
  const { json, endpoint } = await overpass(query)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(json))
  writeFileSync(
    OUT.replace(/\.json$/, '.meta.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), endpoint, osmBase: json.osm3s?.timestamp_osm_base ?? null, licence: 'ODbL 1.0 — © OpenStreetMap contributors', query }, null, 2),
  )
  console.log(`osm extra: ${json.elements.length} elements (shops, emergency points, healthcare, offices)`)
}
