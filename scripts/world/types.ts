import type { HeightSource } from '../../src/lib/geo/height'
import type { GeometryConfidence, Tier } from '../../src/lib/voxel/world-format'
import type { Ring } from './grid'

export interface OfficialBuilding {
  officialId: number
  mapCode: string
  shortCode: string
  nameEn: string
  nameZh: string
  zoneId: number
  hostelType: number | null
  point: { lat: number; lon: number } | null
}

export interface LandmarkDef {
  /** Match: official building code, exact official name, OSM id, or exact OSM English name. */
  match: { code?: string; officialName?: string; osmId?: string; osmName?: string }
  model: string
  title: string
  notes: string
  evidence: string
  referenceLevels?: number
  referenceHeightM?: number
  /** Official landmark entry describing the same object: its official name replaces the OSM name. */
  officialLandmark?: string
}

export interface Bld {
  idx: number
  id: string
  tags: Record<string, string>
  kind: string
  inCampus: boolean
  flags: string[]
  rings: Ring[]
  cells: Int32Array
  i0: number
  j0: number
  i1: number
  j1: number
  areaM2: number
  cx: number
  cz: number
  official?: OfficialBuilding
  aliases: OfficialBuilding[]
  matchMethod?: 'official-name' | 'official-location'
  nameEn: string
  nameZh: string
  category: string
  zoneId: number
  tier: Tier
  levels: number
  heightM: number
  heightSource: HeightSource
  heightConfidence: string
  hBlocks: number
  floorH: number
  /** Ground-floor level (biased block Y). */
  base: number
  /** Highest block (biased) after generation. */
  top: number
  landmark?: LandmarkDef
  geom: GeometryConfidence
  notes: string[]
  aliasNames?: string[]
  /** Lands Department building data overlapping this footprint. */
  ld?: { nameEn: string; nameZh: string; heightM: number; storeys: number | null; coverage: number }
  nameFrom?: 'landsd'
  /** Descriptive label for buildings with no name in any source (not an official name). */
  derivedName?: string
  /** Rendered as plain massing (no façade): under construction, tiny or of unknown height. */
  plain?: boolean
  skip?: boolean
}

export interface State {
  /** Working elevation in metres (graded). */
  elev: Float32Array
  /** Source elevation in metres. */
  elev0: Float32Array
  /** Final biased block heights. */
  H: Uint16Array
  surf: Uint8Array
  /** 0 none · 1 wood · 2 scrub · 3 grass · 4 garden/park · 5 flowerbed */
  cover: Uint8Array
  sea: Uint8Array
  /** 0 free · 1 path/steps · 2 area · 3 road/rail · 4 building · 5 water */
  lock: Uint8Array
  bld: Uint16Array
  sBot: Uint16Array
  sTop: Uint16Array
  sFeat: Uint16Array
  campus: Uint8Array
  entrances: { gx: number; gz: number; main: boolean }[]
}
