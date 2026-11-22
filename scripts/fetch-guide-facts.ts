/**
 * fetch-guide-facts.ts — building facts for the student guide from Wikidata (CC0): for items with a
 * coordinate in the study area, their inception year, architect, architectural style and heritage
 * designation. The coordinate is kept so that a fact is attached only to a building it lies on, and
 * only items that are architectural structures give building facts (an institution's inception is its
 * founding, not a construction date).
 *
 * Output: data/processed/guide-facts.json  { wikidata: [...] }
 * Usage: npx tsx scripts/fetch-guide-facts.ts
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studyAreaRing } from '../src/lib/geo/projection'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'data/processed/guide-facts.json')
const ring = studyAreaRing(0)
const lons = ring.map((p) => p[0])
const lats = ring.map((p) => p[1])
const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
const query = `SELECT ?item ?itemLabel ?coord
  (SAMPLE(YEAR(?inc)) AS ?inception)
  (GROUP_CONCAT(DISTINCT ?archLabel; separator="; ") AS ?architects)
  (GROUP_CONCAT(DISTINCT ?styleLabel; separator="; ") AS ?styles)
  (GROUP_CONCAT(DISTINCT ?herLabel; separator="; ") AS ?heritage)
  (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
  (SAMPLE(?isStructure) AS ?structure)
WHERE {
  SERVICE wikibase:box { ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral . }
  OPTIONAL { ?item wdt:P571 ?inc }
  OPTIONAL { ?item wdt:P84 ?arch . ?arch rdfs:label ?archLabel . FILTER(LANG(?archLabel) = "en") }
  OPTIONAL { ?item wdt:P149 ?style . ?style rdfs:label ?styleLabel . FILTER(LANG(?styleLabel) = "en") }
  OPTIONAL { ?item wdt:P1435 ?her . ?her rdfs:label ?herLabel . FILTER(LANG(?herLabel) = "en") }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
  BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:Q811979 } AS ?isStructure)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?item ?itemLabel ?coord`
const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, {
  headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'voxel-campus-guide-build/0.1 (one-off static data extract)' },
})
if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } }
const wikidata = json.results.bindings
  .map((b) => {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value)
    return {
      id: b.item.value.replace(/^.*\//, ''),
      label: b.itemLabel.value,
      aliases: b.aliases?.value ? b.aliases.value.split('|') : [],
      lon: m ? Number(m[1]) : NaN,
      lat: m ? Number(m[2]) : NaN,
      inception: b.inception?.value ?? '',
      architects: b.architects?.value ?? '',
      styles: b.styles?.value ?? '',
      heritage: b.heritage?.value ?? '',
      /** a building or other architectural structure (not an institution, whose inception is its founding) */
      structure: b.structure?.value === 'true',
    }
  })
  .filter((x) => Number.isFinite(x.lat) && !/^Q\d+$/.test(x.label))
const extra = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>) : {}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ ...extra, sources: { ...((extra.sources as object) ?? {}), wikidata: 'Wikidata (CC0)' }, generatedAt: new Date().toISOString(), wikidata }, null, 1))
console.log(`guide facts: ${wikidata.length} Wikidata items in the study area (${wikidata.filter((x) => x.inception || x.architects || x.heritage).length} with building facts)`)
