import { create } from 'zustand'
import type { PoiCategory } from '../lib/voxel/world-format'

export type CameraMode = 'iso' | 'orbit' | 'explore'
export type TimeOfDay = 'day' | 'sunset' | 'night'
export type Panel = null | 'guide' | 'layers' | 'places' | 'info' | 'directory'
export type InfoTab = 'about' | 'sources' | 'accuracy' | 'controls' | 'accessibility'

export const LAYER_KEYS = ['labels', 'terrain', 'buildings', 'trees', 'roads', 'paths', 'landmarks', 'pois', 'zones', 'confidence'] as const
export type LayerKey = (typeof LAYER_KEYS)[number]
export const LAYER_LABELS: Record<LayerKey, string> = {
  labels: 'Labels',
  terrain: 'Terrain',
  buildings: 'Buildings',
  trees: 'Trees & vegetation',
  roads: 'Roads',
  paths: 'Paths & stairs',
  landmarks: 'Landmarks',
  pois: 'Guide places (food, transit, libraries…)',
  zones: 'Campus zones',
  confidence: 'Source-confidence overlay',
}
export const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  labels: true,
  terrain: true,
  buildings: true,
  trees: true,
  roads: true,
  paths: true,
  landmarks: true,
  pois: true,
  zones: false,
  confidence: false,
}

export interface AppState {
  started: boolean
  loadPhase: string
  loadProgress: number
  loaded: boolean
  catalogReady: boolean
  error: string | null
  webgl: boolean
  mode: CameraMode
  flying: boolean
  layers: Record<LayerKey, boolean>
  time: TimeOfDay
  poiCats: Record<PoiCategory, boolean>
  /** Active walking tour and current stop. */
  tour: { id: string; stop: number } | null
  perf: boolean
  selected: number | null
  hovered: number | null
  panel: Panel
  infoTab: InfoTab
  coarse: boolean
  set: (p: Partial<AppState>) => void
  toggleLayer: (k: LayerKey) => void
  select: (i: number | null) => void
  openInfo: (tab: InfoTab) => void
}

const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

export const useApp = create<AppState>((set) => ({
  started: false,
  loadPhase: 'Preparing',
  loadProgress: 0,
  loaded: false,
  catalogReady: false,
  error: null,
  webgl: true,
  mode: 'iso',
  flying: true,
  layers: { ...DEFAULT_LAYERS },
  time: 'day',
  tour: null,
  poiCats: { transit: true, library: true, cafe: true, food: true, bike: true, health: true, safety: true, shop: true, culture: true, service: true, sport: true, info: true },
  perf: coarse,
  selected: null,
  hovered: null,
  panel: null,
  infoTab: 'about',
  coarse,
  set: (p) => set(p),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  select: (i) => set({ selected: i }),
  openInfo: (tab) => set({ panel: 'info', infoTab: tab }),
}))
