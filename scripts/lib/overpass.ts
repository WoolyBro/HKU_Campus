/** Overpass helper for the one-off guide extracts: endpoint fallback, back-off on 429 / 5xx. */
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
const UA = 'voxel-campus-guide-build/0.1 (one-off static data extract)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function overpass(query: string): Promise<{ json: { elements: Record<string, unknown>[]; osm3s?: { timestamp_osm_base?: string } }; endpoint: string }> {
  let last: unknown
  for (const endpoint of ENDPOINTS)
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(240_000),
        })
        if ([429, 502, 503, 504].includes(res.status)) {
          console.warn(`  ${endpoint} → HTTP ${res.status}; backing off 30 s`)
          await sleep(30_000)
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!json.elements) throw new Error('no elements')
        return { json, endpoint }
      } catch (e) {
        last = e
        console.warn(`  ${endpoint} failed: ${(e as Error).message}`)
        break
      }
    }
  throw new Error(`All Overpass endpoints failed: ${String(last)}`)
}

/** "lat lon lat lon …" polygon filter for the study area. */
export function polyFilter(ring: number[][]): string {
  return `(poly:"${ring
    .slice(0, -1)
    .map(([lon, lat]) => `${lat.toFixed(6)} ${lon.toFixed(6)}`)
    .join(' ')}")`
}
