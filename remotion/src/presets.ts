// Bộ preset hiệu ứng — Gemini chỉ cần trả {preset, intensity, camera?, mood?, transition?}.

export type CameraKind =
  | 'slowPushIn' | 'slowPullOut' | 'panLeft' | 'panRight'
  | 'panUp' | 'panDown' | 'diagonalPush' | 'staticTension' | 'impactZoom';

export type Mood =
  | 'happy' | 'romantic' | 'sad' | 'mystery' | 'danger'
  | 'memory' | 'horror' | 'neutral';

export type TransitionKind =
  | 'fade' | 'dissolve' | 'linearBlur' | 'filmBurn'
  | 'dreamyZoom' | 'pushCut' | 'crossZoom' | 'wipe';

// Camera: nhận progress p∈[0,1] → {scale, x(px), y(px)}. LUÔN có chuyển động (zoom + pan).
export const CAMERA: Record<CameraKind, (p: number) => {scale: number; x: number; y: number}> = {
  slowPushIn:   (p) => ({scale: 1.03 + 0.10 * p, x: -12 * p, y: -7 * p}),
  slowPullOut:  (p) => ({scale: 1.14 - 0.10 * p, x: 10 * p, y: 5 * p}),
  panLeft:      (p) => ({scale: 1.10, x: -46 * p, y: -6 * p}),
  panRight:     (p) => ({scale: 1.10, x: 46 * p, y: -6 * p}),
  panUp:        (p) => ({scale: 1.10, x: 0, y: -40 * p}),
  panDown:      (p) => ({scale: 1.10, x: 0, y: 40 * p}),
  diagonalPush: (p) => ({scale: 1.03 + 0.11 * p, x: -34 * p, y: -20 * p}),
  staticTension:(p) => ({scale: 1.06 + 0.02 * p, x: 3 * Math.sin(p * Math.PI), y: 0}),
  impactZoom:   (p) => ({scale: 1.0 + 0.09 * Math.min(1, p * 2.2), x: 0, y: 0}),
};

// Color grade theo cảm xúc — CSS filter (không cần LUT).
export const MOOD_GRADE: Record<Mood, string> = {
  happy:    'brightness(1.05) saturate(1.18) sepia(0.05)',
  romantic: 'brightness(1.05) saturate(1.12) contrast(0.98) sepia(0.10)',
  sad:      'saturate(0.68) brightness(0.95) contrast(1.03)',
  mystery:  'saturate(0.9) brightness(0.9) contrast(1.1) hue-rotate(-8deg)',
  danger:   'contrast(1.22) brightness(0.9) saturate(1.06)',
  memory:   'sepia(0.28) saturate(0.82) brightness(1.02) contrast(0.95)',
  horror:   'saturate(0.55) brightness(0.8) contrast(1.18) hue-rotate(-10deg)',
  neutral:  'none',
};

export type Preset = {
  camera: CameraKind;
  transition: TransitionKind;
  mood: Mood;
  vignette: number;   // 0..0.6
  grain: number;      // 0..0.08
  shake?: number;     // px biên độ rung (0 = không)
  flash?: boolean;    // chớp sáng đầu cảnh
};

export const EFFECT_PRESETS: Record<string, Preset> = {
  calm:     {camera: 'slowPushIn',   transition: 'linearBlur', mood: 'neutral',  vignette: 0.10, grain: 0.035},
  happy:    {camera: 'panRight',     transition: 'fade',       mood: 'happy',    vignette: 0.08, grain: 0.030},
  romantic: {camera: 'diagonalPush', transition: 'dreamyZoom', mood: 'romantic', vignette: 0.08, grain: 0.040},
  sad:      {camera: 'slowPullOut',  transition: 'dissolve',   mood: 'sad',      vignette: 0.22, grain: 0.045},
  memory:   {camera: 'slowPushIn',   transition: 'filmBurn',   mood: 'memory',   vignette: 0.12, grain: 0.060},
  mystery:  {camera: 'staticTension',transition: 'linearBlur', mood: 'mystery',  vignette: 0.32, grain: 0.050},
  tension:  {camera: 'staticTension',transition: 'linearBlur', mood: 'mystery',  vignette: 0.38, grain: 0.050, shake: 0.5},
  danger:   {camera: 'impactZoom',   transition: 'crossZoom',  mood: 'danger',   vignette: 0.40, grain: 0.055, shake: 2},
  reveal:   {camera: 'impactZoom',   transition: 'pushCut',    mood: 'danger',   vignette: 0.42, grain: 0.050, shake: 2, flash: true},
  horror:   {camera: 'staticTension',transition: 'dissolve',   mood: 'horror',   vignette: 0.45, grain: 0.070, shake: 0.8},
};

export const getPreset = (name?: string): Preset =>
  (name && EFFECT_PRESETS[name]) || EFFECT_PRESETS.calm;

// Trộn preset với intensity → khuếch đại vignette/shake theo cường độ cảnh.
export const applyIntensity = (p: Preset, intensity = 0.4): Preset => ({
  ...p,
  vignette: Math.min(0.55, p.vignette + intensity * 0.15),
  shake: (p.shake || 0) * (0.6 + intensity),
});
