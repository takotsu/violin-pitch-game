// scales.js
export const SCALES = {
  g_scale_4bars: {
    id: 'g_scale_4bars',
    name: 'ト長調（8分×4小節）',
    keySignature: 'G',
    notes: [
      "G4","A4","B4","C5","D5","E5","F#5","G5",
      "G5","F#5","E5","D5","C5","B4","A4","G4",
      "G4","A4","B4","C5","D5","E5","F#5","G5",
      "G5","F#5","E5","D5","C5","B4","A4","G4",
    ]
  }
};

export function getScaleById(id){ return SCALES[id] || null; }
