import { useEffect, useState } from 'react'
import { bus } from '../../app/bus'
import { useWorld } from '../../app/hooks'
import { useApp } from '../../app/store'
import { GUIDE_CAMPUS } from './campus-name'
import { loadTours, type Tour } from './tours'
import { POI_META, POI_ORDER, walkMinutes } from './poi'

/** Student guide: curated walking tours and how to read the map. */
export function GuidePanel() {
  const [tours, setTours] = useState<Tour[]>([])
  const tour = useApp((s) => s.tour)
  const set = useApp((s) => s.set)
  const select = useApp((s) => s.select)
  const world = useWorld()
  useEffect(() => {
    void loadTours().then(setTours)
  }, [])
  const active = tours.find((t) => t.id === tour?.id)
  const go = (t: Tour, k: number) => {
    const st = t.stops[k]
    const f = st && world?.feature(st.i)
    set({ tour: { id: t.id, stop: k } })
    if (f) {
      select(f.i)
      bus.emit({ type: 'flyToPoint', x: f.x, z: f.z, dist: f.kind === 'building' ? 230 : 180 })
    }
  }
  if (active && tour) {
    const st = active.stops[tour.stop]
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold tracking-wide text-slate-600 uppercase">
          Tour · stop {tour.stop + 1} of {active.stops.length}
        </p>
        <h3 className="text-base leading-tight font-bold">{st.name}</h3>
        {tour.stop > 0 && (
          <p className="text-xs text-slate-600">
            About {walkMinutes(st.legM / 1.3)} min walk from the previous stop ({st.legM} m along mapped paths)
          </p>
        )}
        <p className="text-sm">{st.text}</p>
        <div className="flex gap-2">
          <button type="button" className="btn flex-1" disabled={tour.stop === 0} onClick={() => go(active, tour.stop - 1)}>
            ← Previous
          </button>
          <button type="button" className="btn btn-primary flex-1" disabled={tour.stop >= active.stops.length - 1} onClick={() => go(active, tour.stop + 1)}>
            Next →
          </button>
        </div>
        <ol className="list-decimal space-y-0.5 pl-5 text-xs">
          {active.stops.map((s, k) => (
            <li key={s.key}>
              <button type="button" className={`text-left hover:underline ${k === tour.stop ? 'font-bold' : ''}`} onClick={() => go(active, k)}>
                {s.name}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn w-full" onClick={() => set({ tour: null })}>
          End tour
        </button>
        <p className="text-[11px] text-slate-500">The orange route follows mapped paths and is illustrative only — not for navigation or accessibility planning.</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">
        A student&apos;s guide to {GUIDE_CAMPUS}. Click any building for its official name and code, when it was built and by whom, what is mapped inside it, and the nearest station, stops, library
        and food.
      </p>
      <div>
        <p className="mb-1 text-xs font-bold tracking-wide text-slate-600 uppercase">Walking tours</p>
        <ul className="space-y-2">
          {tours.map((t) => (
            <li key={t.id} className="border-2 border-[var(--color-edge)] bg-white p-2">
              <p className="font-semibold">{t.title}</p>
              <p className="text-xs text-slate-600">
                {t.stops.length} stops · {(t.distanceM / 1000).toFixed(1)} km · about {t.minutes} min on foot
              </p>
              <p className="mt-1 text-sm">{t.summary}</p>
              <button type="button" className="btn btn-primary mt-2" onClick={() => go(t, 0)}>
                Start tour
              </button>
            </li>
          ))}
          {!tours.length && <li className="text-sm text-slate-600">Loading tours…</li>}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-bold tracking-wide text-slate-600 uppercase">On the map</p>
        <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
          {POI_ORDER.map((c) => (
            <li key={c}>
              <span aria-hidden="true">{POI_META[c].icon}</span> {POI_META[c].label}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-slate-600">Places appear as you zoom in; filter them under Layers. Try searching “coffee”, “library”, a bus route or a building code.</p>
      </div>
    </div>
  )
}
