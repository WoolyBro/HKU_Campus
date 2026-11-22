/**
 * Walking routes for the curated tours, computed on the block grid with A*.
 *
 * Costs per metre: mapped footpaths and plazas 1, sidewalks 1.05, crossing a carriageway 3,
 * levelled areas (pitches) 2, open ground 2.2, woodland 3. Buildings and water are impassable, and
 * steps of more than one block off a mapped path or stair are heavily penalised (over four blocks: impassable). Diagonal moves may not
 * cut a corner. The result follows real paths where they exist; it is illustrative, not navigation.
 */
import { M } from '../../src/lib/voxel/palette'
import { D, N, W } from './grid'
import type { State } from './types'

const SQ2 = Math.SQRT2

export function cellCost(S: State, c: number): number {
  if (S.bld[c] || S.sea[c]) return Infinity
  const surf = S.surf[c]
  if (surf === M.WATER || surf === M.POOL || surf === M.SEA) return Infinity
  const lock = S.lock[c]
  if (lock === 1 || lock === 2) return 1
  if (lock === 3) return surf === M.PAVEMENT || surf === M.PAVERS || surf === M.PLAZA_BRICK || surf === M.STAIRS ? 1.05 : 3
  if (lock === 5) return 2
  if (surf === M.FOREST_FLOOR || surf === M.SCRUB) return 3
  return 2.2
}

/** Binary min-heap of cell indices keyed by f-score. */
class Heap {
  idx: Int32Array
  key: Float32Array
  n = 0
  constructor(cap: number) {
    this.idx = new Int32Array(cap)
    this.key = new Float32Array(cap)
  }
  push(i: number, k: number) {
    if (this.n >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2)
      ni.set(this.idx)
      const nk = new Float32Array(this.key.length * 2)
      nk.set(this.key)
      this.idx = ni
      this.key = nk
    }
    let p = this.n++
    while (p > 0) {
      const q = (p - 1) >> 1
      if (this.key[q] <= k) break
      this.idx[p] = this.idx[q]
      this.key[p] = this.key[q]
      p = q
    }
    this.idx[p] = i
    this.key[p] = k
  }
  pop(): number {
    const top = this.idx[0]
    const li = this.idx[--this.n],
      lk = this.key[this.n]
    let p = 0
    for (;;) {
      let c = p * 2 + 1
      if (c >= this.n) break
      if (c + 1 < this.n && this.key[c + 1] < this.key[c]) c++
      if (this.key[c] >= lk) break
      this.idx[p] = this.idx[c]
      this.key[p] = this.key[c]
      p = c
    }
    this.idx[p] = li
    this.key[p] = lk
    return top
  }
}

// 64-bit scores: comparing doubles against float32-rounded values re-queues nodes forever
const g = new Float64Array(N)
const closed = new Uint32Array(N)
const from = new Int32Array(N)
const stamp = new Uint32Array(N)
let gen = 0
export const walkStats = { expanded: 0, pushed: 0 }

/**
 * Cheapest walk from `start` to any cell in `goals` (a set), searching inside the bounding box of
 * both plus a margin. `relaxed` lets steep unmapped steps through (at a high cost) for podium decks
 * whose stairs are not mapped. Returns the cell path, or null.
 */
export function walk(S: State, start: number, goals: Set<number>, margin = 350, relaxed = false): number[] | null {
  if (!goals.size) return null
  gen++
  let gi0 = start % W,
    gi1 = gi0,
    gj0 = (start / W) | 0,
    gj1 = gj0
  let gx0 = Infinity,
    gx1 = -Infinity,
    gz0 = Infinity,
    gz1 = -Infinity
  for (const c of goals) {
    const i = c % W,
      j = (c / W) | 0
    gi0 = Math.min(gi0, i)
    gi1 = Math.max(gi1, i)
    gj0 = Math.min(gj0, j)
    gj1 = Math.max(gj1, j)
    gx0 = Math.min(gx0, i)
    gx1 = Math.max(gx1, i)
    gz0 = Math.min(gz0, j)
    gz1 = Math.max(gz1, j)
  }
  const x0 = Math.max(1, gi0 - margin),
    x1 = Math.min(W - 2, gi1 + margin),
    z0 = Math.max(1, gj0 - margin),
    z1 = Math.min(D - 2, gj1 + margin)
  // admissible heuristic: octile distance to the nearest point of the goals' bounding box
  const h = (c: number) => {
    const i = c % W,
      j = (c / W) | 0
    const dx = i < gx0 ? gx0 - i : i > gx1 ? i - gx1 : 0,
      dz = j < gz0 ? gz0 - j : j > gz1 ? j - gz1 : 0
    return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz)
  }
  const heap = new Heap(1 << 16)
  g[start] = 0
  from[start] = -1
  stamp[start] = gen
  heap.push(start, h(start))
  const DI = [1, -1, 0, 0, 1, 1, -1, -1],
    DJ = [0, 0, 1, -1, 1, -1, 1, -1]
  walkStats.expanded = 0
  walkStats.pushed = 0
  while (heap.n) {
    const c = heap.pop()
    if (closed[c] === gen) continue
    closed[c] = gen
    walkStats.expanded++
    if (goals.has(c)) {
      const path: number[] = []
      for (let k = c; k >= 0; k = from[k]) path.push(k)
      return path.reverse()
    }
    const ci = c % W,
      cj = (c / W) | 0
    const gc = g[c]
    for (let d = 0; d < 8; d++) {
      const ni = ci + DI[d],
        nj = cj + DJ[d]
      if (ni < x0 || ni > x1 || nj < z0 || nj > z1) continue
      const n = nj * W + ni
      let cost = cellCost(S, n)
      if (!Number.isFinite(cost) && !goals.has(n)) continue
      if (!Number.isFinite(cost)) cost = 1
      if (d >= 4 && (!Number.isFinite(cellCost(S, cj * W + ni)) || !Number.isFinite(cellCost(S, nj * W + ci)))) continue
      // a step of more than one block off a mapped path or stair is costly (unmapped steps, kerbs on a
      // podium edge) and anything over four blocks is a wall
      const rise = Math.abs(S.H[n] - S.H[c])
      const onWay = S.lock[n] === 1 || S.lock[c] === 1 || S.surf[n] === M.STAIRS
      if (!relaxed && (rise > 4 || (rise > 1 && !onWay && rise > 3))) continue
      const step = (d >= 4 ? SQ2 : 1) * cost + rise * 0.5 + (rise > 1 && !onWay ? 12 * rise : 0)
      const ng = gc + step
      if (stamp[n] === gen && ng >= g[n]) continue
      stamp[n] = gen
      g[n] = ng
      from[n] = c
      heap.push(n, ng + h(n))
      walkStats.pushed++
    }
  }
  return null
}

/** Ramer–Douglas–Peucker simplification of a cell path (tolerance in blocks). */
export function simplify(pts: [number, number][], tol = 1.2): [number, number][] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = -1,
      bi = -1
    const [ax, az] = pts[a],
      [bx, bz] = pts[b]
    const len = Math.hypot(bx - ax, bz - az) || 1
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((bx - ax) * (az - pts[k][1]) - (ax - pts[k][0]) * (bz - az)) / len
      if (d > best) {
        best = d
        bi = k
      }
    }
    if (best > tol) {
      keep[bi] = 1
      stack.push([a, bi], [bi, b])
    }
  }
  return pts.filter((_, k) => keep[k])
}
