import { BASE } from '../../app/runtime'

export interface TourStop {
  i: number
  key: string
  name: string
  text: string
  legM: number
}
export interface Tour {
  id: string
  title: string
  summary: string
  distanceM: number
  minutes: number
  stops: TourStop[]
  /** Route polyline as x, y, z triples in world blocks. */
  path: number[]
}

let cache: Promise<Tour[]> | null = null
/** Curated tours of the current campus (public/world/<campus>/tours.json). */
export function loadTours(): Promise<Tour[]> {
  cache ??= fetch(`${BASE}tours.json`)
    .then((r) => (r.ok ? r.json() : { tours: [] }))
    .then((j: { tours: Tour[] }) => j.tours)
    .catch(() => [])
  return cache
}
