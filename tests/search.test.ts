import { describe, expect, it } from 'vitest'
import { SearchIndex } from '../src/features/search/search'
import { loadWorld, worldBuilt } from './helpers'

describe.skipIf(!worldBuilt)('search', () => {
  const world = worldBuilt ? loadWorld() : null!
  const index = worldBuilt ? new SearchIndex(world.features, world.meta.zones) : null!
  const top = (q: string) => index.search(q)[0]?.feature

  it('finds buildings by official building code', () => {
    expect(top('MB')?.name).toBe('Main Building')
    expect(top('kk')?.name).toBe('K.K. Leung Building')
    expect(top('CYA')?.name).toBe('Chong Yuet Ming Amenities Centre')
  })
  it('finds buildings by English and Chinese names', () => {
    expect(top('main building')?.name).toBe('Main Building')
    expect(top('本部大樓')?.name).toBe('Main Building')
    expect(index.search('圖書館').length).toBeGreaterThan(1)
  })
  it('finds colleges, landmarks, roads and stops', () => {
    expect(top('Centennial Campus')?.kind).toBe('zone')
    expect(top('Lily Pond')?.kind).toBe('landmark')
    expect(index.search('station').some((h) => h.feature.name.startsWith('HKU Station'))).toBe(true)
    expect(index.search('road').some((h) => h.feature.kind === 'road')).toBe(true)
  })
  it('returns nothing for nonsense', () => {
    expect(index.search('zzzzqqq')).toEqual([])
    expect(index.search('   ')).toEqual([])
  })
})
