/** Draws the active tour's walking route as a bright ribbon just above the ground. */
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { runtime } from '../app/runtime'
import { useApp } from '../app/store'
import { loadTours, type Tour } from '../features/guide/tours'

function ribbon(path: number[], width: number): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const n = path.length / 3
  for (let k = 0; k < n; k++) {
    const x = path[k * 3],
      y = path[k * 3 + 1],
      z = path[k * 3 + 2]
    const a = Math.max(0, k - 1),
      b = Math.min(n - 1, k + 1)
    let dx = path[b * 3] - path[a * 3],
      dz = path[b * 3 + 2] - path[a * 3 + 2]
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    pos.push(x - dz * width, y, z + dx * width, x + dz * width, y, z - dx * width)
    if (k < n - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

export function TourLayer() {
  const tour = useApp((s) => s.tour)
  const [tours, setTours] = useState<Tour[]>([])
  useEffect(() => {
    if (tour) void loadTours().then(setTours)
  }, [tour])
  const active = tours.find((t) => t.id === tour?.id)
  const geo = useMemo(() => (active && active.path.length >= 6 ? ribbon(active.path, 2.2) : null), [active])
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 }),
    [],
  )
  useEffect(() => {
    runtime.invalidate()
  }, [geo])
  if (!geo) return null
  return <mesh geometry={geo} material={mat} renderOrder={5} raycast={() => {}} />
}
