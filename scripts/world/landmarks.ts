/**
 * Tier A — bespoke landmark models for the HKU campus.
 *
 * Each model starts from the landmark's real OSM footprint (so position, orientation and plan
 * shape stay data-driven) and replaces the generic façade rules with hand-written block
 * architecture. Form, colour and roof character were checked against the photographs published
 * with the official HKU Campus Map entry for each landmark (private reference only — no photo
 * is shipped). They remain stylised interpretations: see docs/ACCURACY.md.
 */
import { M } from '../../src/lib/voxel/palette'
import type { Volume } from '../../src/lib/voxel/mesher'
import { cellIndex } from './grid'
import { entrances, facadeBlock, hipRoof, roofEquipment, shell, type Prep, type Style } from './buildings'
import type { Bld, LandmarkDef, State } from './types'

const MAP = 'https://www.maps.hku.hk/'

export const LANDMARKS: LandmarkDef[] = [
  {
    match: { code: 'MB' },
    model: 'main_building',
    title: 'Main Building',
    evidence: MAP,
    notes: 'Red brick and cream stone colonnades with corner turrets and a central clock tower, modelled from the official map photographs. Tower position and proportions are interpreted.',
  },
  {
    match: { code: 'HH' },
    model: 'domed_pavilion',
    title: 'Hung Hing Ying Building',
    evidence: MAP,
    notes: 'White classical building with a colonnaded front and central dome, modelled from the official map photograph.',
  },
  { match: { code: 'EH' }, model: 'brick_hall', title: 'Eliot Hall', evidence: MAP, notes: 'Red-brick hall with white bands and arcaded verandahs, modelled from the official map photograph.' },
  { match: { code: 'MH' }, model: 'brick_hall', title: 'May Hall', evidence: MAP, notes: 'Red-brick hall with white arched verandahs, modelled from the official map photograph.' },
  { match: { code: 'FP' }, model: 'brick_museum', title: 'Fung Ping Shan Building', evidence: MAP, notes: 'Red brick over a cream stone base, modelled from the official map photograph.' },
  {
    match: { code: 'TC' },
    model: 'stone_classical',
    title: 'Tang Chi Ngong Building',
    evidence: MAP,
    notes: 'Grey rendered classical block with a balustraded parapet, modelled from the official map photograph.',
  },
  {
    match: { officialName: 'The Jockey Club Tower' },
    model: 'centennial_tower',
    title: 'The Jockey Club Tower',
    evidence: MAP,
    notes: 'Glazed tower with terracotta-coloured vertical fins and a planted roof, modelled from the official map photograph.',
  },
  {
    match: { officialName: 'Run Run Shaw Tower' },
    model: 'centennial_tower',
    title: 'Run Run Shaw Tower',
    evidence: MAP,
    notes: 'Glazed tower with terracotta-coloured bands and a planted roof, modelled from the official map photograph.',
  },
  {
    match: { osmName: 'The University of Hong Kong Run Run Shaw Tower' },
    model: 'centennial_tower',
    title: 'Run Run Shaw Tower (second block)',
    evidence: MAP,
    notes: 'Second mapped block of the Run Run Shaw Tower; same façade language.',
  },
  {
    match: { officialName: 'Cheng Yu Tung Tower' },
    model: 'centennial_tower',
    title: 'Cheng Yu Tung Tower',
    evidence: MAP,
    notes: 'Tower with terracotta-coloured vertical fins, modelled from the official map photograph.',
  },
  {
    match: { code: 'RBC' },
    model: 'chinese_court',
    title: 'Robert Black College',
    evidence: MAP,
    notes: 'White walls under green glazed tile roofs; roof geometry is stylised from the official map photograph of the gate.',
  },
  {
    match: { officialName: 'Run Run Shaw Heritage House' },
    model: 'heritage_house',
    title: 'Run Run Shaw Heritage House',
    evidence: MAP,
    notes: 'Brick house with red tiled hip roof, modelled from the official map photograph.',
  },
  {
    match: { code: 'KBS' },
    model: 'hightech',
    title: 'Kadoorie Biological Sciences Building',
    evidence: MAP,
    notes: 'White high-tech block with an expressed frame, modelled from the official map photographs.',
  },
]

const base: Style = {
  wall: M.WALL_WHITE,
  band: M.SLAB,
  plinth: M.CONCRETE,
  window: M.WINDOW,
  glass: M.GLASS_BLUE,
  roof: M.ROOF_FLAT,
  accent: M.SLAB,
  pattern: 'fins',
  ground: 'solid',
  bay: 3,
  parapet: true,
  roofType: 'flat',
  roofTile: M.ROOF_TILE_GREY,
  equipment: true,
}

/** Adds a one-block cantilever ring around the footprint between two heights. */
function overhang(vol: Volume, P: Prep, y0: number, y1: number, mat: (y: number, l: number) => number) {
  for (let l = 0; l < P.inside.length; l++) {
    if (P.dist[l] !== 1) continue
    const i = P.ox + (l % P.sx),
      j = P.oz + ((l / P.sx) | 0)
    const nx = Math.round(P.nx[l]),
      nz = Math.round(P.nz[l])
    if (nx === 0 && nz === 0) continue
    for (let y = y0; y < y1; y++) {
      vol.add(i + nx, y, j + nz, mat(y, l))
      if (nx !== 0 && nz !== 0) {
        vol.add(i + nx, y, j, mat(y, l))
        vol.add(i, y, j + nz, mat(y, l))
      }
    }
  }
}

function disc(vol: Volume, cx: number, cz: number, r: number, y0: number, y1: number, mat: (i: number, y: number, j: number, d: number) => number) {
  const R = Math.ceil(r)
  for (let dj = -R; dj <= R; dj++)
    for (let di = -R; di <= R; di++) {
      const d = Math.hypot(di, dj)
      if (d > r + 0.2) continue
      for (let y = y0; y < y1; y++) vol.set(Math.floor(cx) + di, y, Math.floor(cz) + dj, mat(di, y, dj, d))
    }
}

/** Local frame of a cell: distance along / across the footprint's long axis from its centre. */
function frame(P: Prep, l: number): [number, number] {
  const px = P.ox + (l % P.sx) + 0.5 - P.cx,
    pz = P.oz + ((l / P.sx) | 0) + 0.5 - P.cz
  return [px * P.ux + pz * P.uz, -px * P.uz + pz * P.ux]
}

/** A square tower rising from the roof, with a stepped cap. */
function tower(vol: Volume, cx: number, cz: number, half: number, y0: number, y1: number, wall: number, cap: number, clock = false) {
  const i0 = Math.floor(cx),
    j0 = Math.floor(cz)
  for (let dj = -half; dj <= half; dj++)
    for (let di = -half; di <= half; di++)
      for (let y = y0; y < y1; y++) {
        const onX = Math.abs(di) === half,
          onZ = Math.abs(dj) === half
        const side = onX !== onZ // on a face, not a corner
        const off = onX ? Math.abs(dj) : Math.abs(di) // distance from the middle of that face
        let m = wall
        if (side && clock && y >= y1 - 5 && y <= y1 - 3 && off <= 1) m = off === 0 && y === y1 - 4 ? M.METAL_DARK : M.WALL_WHITE
        else if (side && off === 0 && (y - y0) % 4 === 2 && y < y1 - 5) m = M.WINDOW
        vol.set(i0 + di, y, j0 + dj, m)
      }
  for (let k = 0; k <= half; k++) for (let dj = -half + k; dj <= half - k; dj++) for (let di = -half + k; di <= half - k; di++) vol.set(i0 + di, y1 + k, j0 + dj, cap)
}

/** Repaints the façade row at every floor line (above the ground storey) as a contrasting band. */
function floorBands(vol: Volume, b: Bld, P: Prep, from: number, band: number) {
  for (let l = 0; l < P.inside.length; l++) {
    if (P.dist[l] !== 1) continue
    const i = P.ox + (l % P.sx),
      j = P.oz + ((l / P.sx) | 0)
    for (let y = b.base + b.floorH; y < b.base + b.hBlocks; y += b.floorH) if (vol.get(i, y, j) === from) vol.set(i, y, j, band)
  }
}

type Model = (vol: Volume, b: Bld, S: State, P: Prep) => void

export const MODELS: Record<string, Model> = {
  /**
   * Main Building — red brick with cream stone colonnades on every outer face, cream parapet,
   * low tiled roofs, four corner turrets and a central clock tower on the downhill front.
   */
  main_building(vol, b, S, P) {
    const st: Style = {
      ...base,
      wall: M.WALL_BRICK_RED,
      band: M.SLAB,
      plinth: M.WALL_STONE,
      pattern: 'punched',
      window: M.WINDOW,
      ground: 'arcade',
      bay: 4,
      equipment: false,
      roofTile: M.ROOF_TILE_RED,
      accent: M.SLAB,
    }
    shell(vol, b, S, P, st)
    floorBands(vol, b, P, M.WALL_BRICK_RED, M.SLAB)
    const top = b.base + b.hBlocks
    hipRoof(vol, b, P, M.ROOF_TILE_RED, 0.34, 3)
    // which long side faces downhill (the formal front)?
    let lo = 0,
      hi = 0,
      nLo = 0,
      nHi = 0
    for (let l = 0; l < P.inside.length; l++) {
      if (P.dist[l] !== 1) continue
      const [, across] = frame(P, l)
      if (across < -P.halfWid + 3) {
        lo += P.gOut[l]
        nLo++
      } else if (across > P.halfWid - 3) {
        hi += P.gOut[l]
        nHi++
      }
    }
    const front = (nLo ? lo / nLo : 0) <= (nHi ? hi / nHi : 0) ? -1 : 1
    const at = (along: number, across: number): [number, number] => [P.cx + P.ux * along - P.uz * across, P.cz + P.uz * along + P.ux * across]
    // corner turrets
    for (const sa of [-1, 1])
      for (const sc of [-1, 1]) {
        const [x, z] = at(sa * (P.halfLen - 3), sc * (P.halfWid - 3))
        tower(vol, x, z, 2, top - 1, top + 5, M.SLAB, M.ROOF_TILE_GREY)
      }
    // central clock tower with four small pinnacles
    const [tx, tz] = at(0, front * (P.halfWid - 5))
    tower(vol, tx, tz, 3, top - 1, top + 13, M.SLAB, M.ROOF_TILE_GREY, true)
    for (const dx of [-3, 3]) for (const dz of [-3, 3]) for (let y = top + 13; y < top + 16; y++) vol.set(Math.floor(tx) + dx, y, Math.floor(tz) + dz, M.SLAB)
    entrances(vol, b, S, P, true)
  },

  /** Hung Hing Ying Building — white classical block, colonnaded ground floor, central dome with lantern. */
  domed_pavilion(vol, b, S, P) {
    const st: Style = { ...base, wall: M.WALL_WHITE, band: M.WALL_WHITE, plinth: M.WALL_STONE, pattern: 'punched', window: M.WINDOW, ground: 'arcade', bay: 3, equipment: false, accent: M.WALL_WHITE }
    shell(vol, b, S, P, st)
    const top = b.base + b.hBlocks
    const r = Math.max(3, Math.min(6, P.halfWid * 0.55))
    disc(vol, P.cx, P.cz, r + 0.6, top, top + 2, () => M.WALL_WHITE)
    for (let k = 0; k <= r; k++) disc(vol, P.cx, P.cz, Math.sqrt(Math.max(0.5, r * r - k * k)), top + 2 + k, top + 3 + k, () => M.SLAB)
    disc(vol, P.cx, P.cz, 0.6, top + 3 + Math.floor(r), top + 5 + Math.floor(r), () => M.WALL_WHITE)
    entrances(vol, b, S, P, true)
  },

  /** Eliot Hall / May Hall — red brick, white floor bands, white arcaded verandah, dark tiled hip roof. */
  brick_hall(vol, b, S, P) {
    const st: Style = {
      ...base,
      wall: M.WALL_BRICK_RED,
      band: M.WALL_WHITE,
      plinth: M.WALL_STONE,
      pattern: 'punched',
      window: M.WINDOW,
      ground: 'arcade',
      bay: 3,
      parapet: false,
      equipment: false,
      accent: M.WALL_WHITE,
    }
    shell(vol, b, S, P, st)
    floorBands(vol, b, P, M.WALL_BRICK_RED, M.WALL_WHITE)
    hipRoof(vol, b, P, M.ROOF_TILE_GREY, 0.45, 4, true)
    entrances(vol, b, S, P, true)
  },

  /** Fung Ping Shan Building — red brick upper floors on a cream stone ground storey. */
  brick_museum(vol, b, S, P) {
    const st: Style = { ...base, wall: M.WALL_BRICK_RED, band: M.SLAB, plinth: M.SLAB, pattern: 'punched', window: M.WINDOW, bay: 4, equipment: false, accent: M.SLAB }
    shell(vol, b, S, P, st)
    // cream ground storey
    for (let l = 0; l < P.inside.length; l++) {
      if (P.dist[l] !== 1) continue
      const i = P.ox + (l % P.sx),
        j = P.oz + ((l / P.sx) | 0)
      for (let y = Math.min(P.gOut[l], b.base); y < b.base + b.floorH; y++) if (vol.get(i, y, j) === M.WALL_BRICK_RED) vol.set(i, y, j, M.SLAB)
    }
    entrances(vol, b, S, P, true)
  },

  /** Tang Chi Ngong Building — grey rendered classical block with regular tall windows. */
  stone_classical(vol, b, S, P) {
    const st: Style = { ...base, wall: M.WALL_GREY, band: M.SLAB, plinth: M.WALL_STONE, pattern: 'punched', window: M.WINDOW, bay: 3, equipment: false, accent: M.SLAB }
    shell(vol, b, S, P, st)
    entrances(vol, b, S, P, true)
  },

  /** Centennial Campus towers — glazing behind terracotta-coloured vertical fins, glazed podium, planted roof. */
  centennial_tower(vol, b, S, P) {
    const st: Style = { ...base, wall: M.WALL_TERRACOTTA, band: M.SLAB, plinth: M.CONCRETE, pattern: 'curtain', glass: M.GLASS_GREEN, ground: 'glass', bay: 3 }
    shell(vol, b, S, P, st)
    const top = b.base + b.hBlocks
    for (let l = 0; l < P.inside.length; l++) {
      if (!P.inside[l]) continue
      const i = P.ox + (l % P.sx),
        j = P.oz + ((l / P.sx) | 0)
      if (P.dist[l] === 1) {
        // terracotta fins on every other block above the podium
        if (Math.floor(P.edgeT[l]) % 2 === 0) for (let y = b.base + b.floorH; y < top - 1; y++) if (vol.get(i, y, j) === M.GLASS_GREEN) vol.set(i, y, j, M.WALL_TERRACOTTA)
      } else if (P.dist[l] >= 3 && P.dist[l] <= 9) vol.set(i, top - 1, j, M.LAWN)
    }
    roofEquipment(vol, b, P, st)
    entrances(vol, b, S, P, true)
  },

  /** Robert Black College — white walls, red posts at the corners, green glazed tile roofs with deep eaves. */
  chinese_court(vol, b, S, P) {
    const st: Style = { ...base, wall: M.WALL_WHITE, band: M.WALL_WHITE, plinth: M.WALL_STONE, pattern: 'punched', window: M.WINDOW, bay: 3, parapet: false, equipment: false, accent: M.ACCENT_RED }
    shell(vol, b, S, P, st)
    for (let l = 0; l < P.inside.length; l++) {
      if (P.dist[l] !== 1 || (P.edgeT[l] >= 1 && P.edgeT[l] <= P.edgeL[l] - 1)) continue
      const i = P.ox + (l % P.sx),
        j = P.oz + ((l / P.sx) | 0)
      for (let y = P.gOut[l]; y < b.base + b.hBlocks - 1; y++) vol.set(i, y, j, M.ACCENT_RED)
    }
    hipRoof(vol, b, P, M.ROOF_TILE_GREEN, 0.5, 4, true)
  },

  /** Run Run Shaw Heritage House — brick house under a red tiled hip roof. */
  heritage_house(vol, b, S, P) {
    const st: Style = {
      ...base,
      wall: M.WALL_TILE_BEIGE,
      band: M.WALL_TILE_BEIGE,
      plinth: M.WALL_STONE,
      pattern: 'punched',
      window: M.WINDOW,
      bay: 3,
      parapet: false,
      equipment: false,
      accent: M.WALL_TILE_BEIGE,
    }
    shell(vol, b, S, P, st)
    hipRoof(vol, b, P, M.ROOF_TILE_RED, 0.5, 4, true)
    entrances(vol, b, S, P, true)
  },

  /** Kadoorie Biological Sciences Building — white block with an expressed frame and service fins. */
  hightech(vol, b, S, P) {
    const st: Style = { ...base, wall: M.WALL_WHITE, band: M.SLAB, plinth: M.CONCRETE, pattern: 'fins', glass: M.GLASS_BLUE, ground: 'arcade', bay: 4 }
    shell(vol, b, S, P, st)
    const top = b.base + b.hBlocks
    overhang(vol, P, top - 1, top, () => M.SLAB)
    overhang(vol, P, b.base + b.floorH, b.base + b.floorH + 1, () => M.ACCENT_GREEN)
    roofEquipment(vol, b, P, st)
    entrances(vol, b, S, P, true)
  },

  /** Station entrances and other open transport structures: a roof on columns with a red fascia. */
  station(vol, b, S, P) {
    const roofY = b.base + 4
    for (let l = 0; l < P.inside.length; l++) {
      if (!P.inside[l]) continue
      const i = P.ox + (l % P.sx),
        j = P.oz + ((l / P.sx) | 0)
      vol.set(i, roofY, j, P.dist[l] === 1 ? M.ACCENT_RED : M.ROOF_METAL)
      if (P.dist[l] === 1 && (P.edgeT[l] < 1 || P.edgeT[l] > P.edgeL[l] - 1 || Math.floor(P.edgeT[l]) % 6 === 3)) for (let y = S.H[cellIndex(i, j)]; y < roofY; y++) vol.set(i, y, j, M.COLUMN)
    }
  },
}

/** Models that are open structures whose footprint must stay walkable (no terrain cut, no solid fill). */
export const OPEN_MODELS = new Set<string>(['station'])

export { facadeBlock }
