/** Guided fly-to destinations. Each resolves to a feature in the catalogue by key or exact name. */
export interface Preset {
  label: string
  /** Feature key ("zone/2") or exact feature name. */
  ref: string
  group: 'Arrive' | 'Campuses' | 'Heritage' | 'Academic' | 'Outdoors' | 'Halls'
  dist?: number
}

export const PRESETS: Preset[] = [
  { label: 'HKU MTR Station', ref: 'HKU Station (MTR Island Line)', group: 'Arrive', dist: 380 },
  { label: 'East Gate', ref: 'East Gate', group: 'Arrive', dist: 220 },
  { label: 'West Gate', ref: 'West Gate', group: 'Arrive', dist: 220 },
  { label: 'Centennial Gate', ref: 'Centennial Gate', group: 'Arrive', dist: 220 },
  { label: 'Main Campus', ref: 'zone/1', group: 'Campuses', dist: 620 },
  { label: 'Centennial Campus', ref: 'zone/2', group: 'Campuses', dist: 420 },
  { label: 'Main Building', ref: 'Main Building', group: 'Heritage', dist: 280 },
  { label: 'Hung Hing Ying Building', ref: 'Hung Hing Ying Building', group: 'Heritage', dist: 180 },
  { label: 'Eliot Hall & May Hall', ref: 'Eliot Hall', group: 'Heritage', dist: 220 },
  { label: 'Fung Ping Shan Building', ref: 'Fung Ping Shan Building', group: 'Heritage', dist: 200 },
  { label: 'Tang Chi Ngong Building', ref: 'Tang Chi Ngong Building', group: 'Heritage', dist: 200 },
  { label: 'Main Library', ref: 'Library Building (New Wing)', group: 'Academic', dist: 260 },
  { label: 'K.K. Leung Building', ref: 'K.K. Leung Building', group: 'Academic', dist: 300 },
  { label: 'Knowles Building', ref: 'Knowles Building', group: 'Academic', dist: 280 },
  { label: 'Haking Wong Building', ref: 'Haking Wong Building', group: 'Academic', dist: 260 },
  { label: 'Chong Yuet Ming Amenities Centre', ref: 'Chong Yuet Ming Amenities Centre', group: 'Academic', dist: 240 },
  { label: 'Kadoorie Biological Sciences Building', ref: 'Kadoorie Biological Sciences Building', group: 'Academic', dist: 260 },
  { label: 'The Jockey Club Tower', ref: 'The Jockey Club Tower', group: 'Academic', dist: 300 },
  { label: 'Cheng Yu Tung Tower', ref: 'Cheng Yu Tung Tower', group: 'Academic', dist: 280 },
  { label: 'Lily Pond', ref: 'Lily Pond', group: 'Outdoors', dist: 160 },
  { label: 'Sun Yat-sen Place', ref: 'Sun Yat-sen Place', group: 'Outdoors', dist: 180 },
  { label: 'Central Podium (University Street)', ref: 'Central Podium Levels (CPD)', group: 'Outdoors', dist: 260 },
  { label: 'Robert Black College', ref: 'Robert Black College', group: 'Halls', dist: 240 },
  { label: 'Halls on Pok Fu Lam Road', ref: 'Starr Hall', group: 'Halls', dist: 320 },
  { label: "St. John's College", ref: "St. John's College", group: 'Halls', dist: 260 },
  { label: 'Jockey Club Student Village', ref: 'Lee Shau Kee Hall', group: 'Halls', dist: 320 },
]
