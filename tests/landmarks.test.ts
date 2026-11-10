/**
 * Coordinate validation against official HKU mapping.
 *
 * The expected latitude / longitude values below are the points published for each building on
 * the official HKU Campus Map (https://www.maps.hku.hk/), recorded on 2026-11-10. The model's
 * positions come from OpenStreetMap footprints, so these tests check two independent sources
 * against each other through the project's projection.
 */
import { describe, expect, it } from 'vitest'
import { lonLatToWorld } from '../src/lib/geo/projection'
import { loadWorld, worldBuilt } from './helpers'

const OFFICIAL: { name: string; code: string; lat: number; lon: number }[] = [
  { name: 'Main Building', code: 'MB', lat: 22.283939, lon: 114.137869 },
  { name: 'K.K. Leung Building', code: 'KK', lat: 22.283278, lon: 114.13906 },
  { name: 'Knowles Building', code: 'KB', lat: 22.283254, lon: 114.138438 },
  { name: 'Hung Hing Ying Building', code: 'HH', lat: 22.284594, lon: 114.138129 },
  { name: 'Haking Wong Building', code: 'HW', lat: 22.282981, lon: 114.136442 },
  { name: 'Chong Yuet Ming Amenities Centre', code: 'CYA', lat: 22.282708, lon: 114.139076 },
  { name: 'The Jockey Club Tower', code: '', lat: 22.283174, lon: 114.134704 },
  { name: 'Cheng Yu Tung Tower', code: '', lat: 22.283308, lon: 114.133739 },
  { name: 'Eliot Hall', code: 'EH', lat: 22.282529, lon: 114.139682 },
  { name: 'Starr Hall', code: 'STH', lat: 22.283807, lon: 114.132859 },
]

describe.skipIf(!worldBuilt)('landmark coordinates vs official HKU map', () => {
  const world = worldBuilt ? loadWorld() : null!
  const building = (name: string) => world.features.find((f) => f.kind === 'building' && f.name === name)

  it.each(OFFICIAL)('$name sits on its official map point', ({ name, code, lat, lon }) => {
    const f = building(name)
    expect(f, `${name} missing from the model`).toBeDefined()
    expect(f!.short ?? '').toBe(code)
    const p = lonLatToWorld(lon, lat)
    // the official point must fall inside (or within 20 blocks of) the modelled footprint
    const [x0, z0, x1, z1] = f!.bbox!
    const dx = Math.max(x0 - p.x, 0, p.x - x1),
      dz = Math.max(z0 - p.z, 0, p.z - z1)
    expect(Math.hypot(dx, dz)).toBeLessThan(20)
    // and the footprint centroid must be within 45 m of it
    expect(Math.hypot(f!.x - p.x, f!.z - p.z)).toBeLessThan(45)
    // stored geographic position agrees with the block position
    const back = lonLatToWorld(f!.lon, f!.lat)
    expect(Math.hypot(back.x - f!.x, back.z - f!.z)).toBeLessThan(0.6)
  })

  it('keeps the campus the right way round', () => {
    const main = building('Main Building')!,
      jct = building('The Jockey Club Tower')!,
      starr = building('Starr Hall')!,
      rbc = building('Robert Black College')!
    expect(jct.x).toBeLessThan(main.x) // the Centennial Campus is west of the Main Building (+X = east)
    expect(starr.x).toBeLessThan(jct.x) // the halls on Pok Fu Lam Road are further west
    expect(rbc.z).toBeGreaterThan(main.z) // Robert Black College is uphill, to the south (+Z = south)
  })

  it('reproduces the hillside: the campus climbs from the city towards Lung Fu Shan', () => {
    const base = (name: string) => {
      const f = building(name)!
      return f.y - (f.heightM ?? 0)
    }
    expect(base('Kennedy Town Centre')).toBeLessThan(30) // near the waterfront
    expect(base('Main Building')).toBeGreaterThan(55)
    expect(base('Main Building')).toBeLessThan(95)
    expect(base('Robert Black College')).toBeGreaterThan(base('Main Building') + 20) // upper University Drive
  })
})
