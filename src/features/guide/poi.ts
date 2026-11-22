import type { PoiCategory } from '../../lib/voxel/world-format'

/** Icons and names of the student-guide point-of-interest categories. */
export const POI_META: Record<PoiCategory, { icon: string; label: string; colour: string }> = {
  transit: { icon: '🚇', label: 'Transit', colour: '#c8102e' },
  library: { icon: '📚', label: 'Libraries', colour: '#4b3f9e' },
  cafe: { icon: '☕', label: 'Cafés', colour: '#7a4b21' },
  food: { icon: '🍽', label: 'Food', colour: '#b5501c' },
  bike: { icon: '🚲', label: 'Bike Share & bikes', colour: '#2e7d32' },
  health: { icon: '⚕', label: 'Health', colour: '#00796b' },
  safety: { icon: '🆘', label: 'Safety', colour: '#d32f2f' },
  shop: { icon: '🛍', label: 'Shops', colour: '#6a1b9a' },
  culture: { icon: '🎭', label: 'Culture & art', colour: '#ad1457' },
  service: { icon: '🏧', label: 'Services', colour: '#455a64' },
  sport: { icon: '🏋', label: 'Sport & fitness', colour: '#1565c0' },
  info: { icon: 'ℹ', label: 'Information', colour: '#0277bd' },
}
export const POI_ORDER: PoiCategory[] = ['transit', 'library', 'cafe', 'food', 'bike', 'sport', 'health', 'safety', 'culture', 'shop', 'service', 'info']

/** Walking time at ~80 m/min with a 1.3 detour factor on the straight-line distance (approximate). */
export const walkMinutes = (distM: number) => Math.max(1, Math.round((distM * 1.3) / 80))
