import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {useAudioData, visualizeAudio} from '@remotion/media-utils';
import {CAMERA, CameraKind} from './presets';
import {NOISE_URI} from './noise';

// Ảnh + chuyển động camera (zoom+pan) + pseudo-parallax (nền mờ + lớp nét) + rung.
export const CameraImage: React.FC<{
  image: string; camera: CameraKind; grade: string; shake?: number;
}> = ({image, camera, grade, shake = 0}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const p = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const cam = CAMERA[camera](p);
  // rung chỉ mạnh trong ~14 frame đầu rồi tắt dần
  const shakeEnv = shake ? shake * Math.max(0, 1 - frame / 16) : 0;
  const sx = shakeEnv ? Math.sin(frame * 2.4) * shakeEnv : 0;
  const sy = shakeEnv ? Math.cos(frame * 3.1) * shakeEnv : 0;
  // Chỉ 1 lớp ảnh nét (bỏ lớp blur nền — blur toàn màn mỗi khung rất chậm khi render).
  return (
    <AbsoluteFill style={{filter: grade === 'none' ? undefined : grade, backgroundColor: '#0a0f1a'}}>
      <AbsoluteFill style={{transform: `translate(${cam.x + sx}px, ${cam.y + sy}px) scale(${cam.scale})`}}>
        <Img src={image} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Film grain động — TILE texture noise tĩnh (data-URI) + dời vị trí mỗi 2 khung.
// Thay feTurbulence (SVG filter rất nặng, tính lại toàn khung mỗi frame) → render nhanh hơn
// nhiều lần (đặc biệt khi worker fallback CPU), nhìn vẫn như grain phim.
export const FilmGrain: React.FC<{opacity: number}> = ({opacity}) => {
  const frame = useCurrentFrame();
  if (opacity <= 0) return null;
  const step = Math.floor(frame / 2);
  const ox = (step * 47) % 128;   // dời tất-định → grain "nhấp nháy" động
  const oy = (step * 89) % 128;
  return (
    <AbsoluteFill style={{
      opacity, mixBlendMode: 'overlay', pointerEvents: 'none',
      backgroundImage: `url(${NOISE_URI})`,
      backgroundRepeat: 'repeat',
      backgroundPosition: `${ox}px ${oy}px`,
    }} />
  );
};

// Vignette (mạnh dần theo strength).
export const Vignette: React.FC<{strength: number}> = ({strength}) => {
  if (strength <= 0) return null;
  return (
    <AbsoluteFill style={{
      pointerEvents: 'none',
      background: `radial-gradient(ellipse 78% 78% at 50% 46%, transparent 42%, rgba(0,0,0,${strength}) 100%)`,
    }} />
  );
};

// Chớp sáng tại 1 mốc frame.
export const FlashHit: React.FC<{atFrame: number}> = ({atFrame}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [atFrame, atFrame + 1, atFrame + 5], [0, 0.65, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  if (o <= 0.001) return null;
  return <AbsoluteFill style={{background: '#fff', opacity: o, pointerEvents: 'none'}} />;
};

// Chia câu thành cụm 4–7 từ.
const chunkWords = (text: string, size = 6): string[] => {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(' '));
  return out.length ? out : [''];
};
const clean = (w: string) => w.toLowerCase().replace(/[.,!?;:"'“”…]/g, '');

// Karaoke caption: canh GIỮA-TRÁI. Chỉ hiện TỐI ĐA ~5 HÀNG một lúc (chia "trang"),
// hết trang thì sang trang tiếp theo chạy theo giọng. Chữ đã đọc sáng, đang đọc phóng to,
// keyword tô vàng.
const WORDS_PER_PAGE = 24;   // ~5 hàng ở cỡ chữ + độ rộng bên dưới

export const KaraokeCaption: React.FC<{text: string; keywords?: {text: string}[]; wordTimings?: number[]}> = ({text, keywords, wordTimings}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const kw = (keywords || []).flatMap((k) => clean(k.text).split(/\s+/));

  const pages: string[][] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_PAGE) pages.push(words.slice(i, i + WORDS_PER_PAGE));

  // headGlobal = số từ đã ĐỌC (0..words.length). Ưu tiên MỐC THỜI GIAN THẬT của giọng
  // (wordTimings) để tô chữ đúng lúc đọc; thiếu timings → nội suy tuyến tính (như cũ).
  const useTimings = Array.isArray(wordTimings) && wordTimings.length === words.length;
  let headGlobal: number;
  if (useTimings) {
    const t = frame / fps;
    let k = 0;
    while (k < wordTimings.length && wordTimings[k] <= t) k++;
    if (k > 0 && k < wordTimings.length) {
      const span = Math.max(0.001, wordTimings[k] - wordTimings[k - 1]);
      headGlobal = (k - 1) + Math.min(1, (t - wordTimings[k - 1]) / span);   // chạy mượt trong từ
    } else {
      headGlobal = k;
    }
  } else {
    headGlobal = interpolate(frame, [0, durationInFrames], [0, 1],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) * words.length;
  }

  const curWordIdx = Math.min(words.length - 1, Math.floor(headGlobal));
  const pIdx = Math.min(pages.length - 1, Math.floor(curWordIdx / WORDS_PER_PAGE));
  const cur = pages[pIdx];
  const head = headGlobal - pIdx * WORDS_PER_PAGE;   // vị trí từ đang đọc TRONG trang

  let appear: number;
  if (useTimings) {
    const pageStartT = wordTimings[pIdx * WORDS_PER_PAGE] ?? 0;
    appear = interpolate(frame / fps, [pageStartT, pageStartT + 0.25], [0, 1],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  } else {
    const per = durationInFrames / pages.length;
    appear = interpolate(frame - pIdx * per, [0, 8], [0, 1],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  }

  return (
    <AbsoluteFill style={{alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 84, paddingRight: '44%'}}>
      <div style={{opacity: appear, fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 40, fontWeight: 800,
        lineHeight: 1.5, textAlign: 'left', textShadow: '0 3px 16px rgba(0,0,0,.95)',
        display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>
        {cur.map((w, i) => {
          const spoken = i < head;
          const active = i <= head && i > head - 1;
          const cw = clean(w);
          const isKw = cw.length > 1 && kw.some((k) => k && (cw.includes(k) || k.includes(cw)));
          const color = spoken ? (isKw ? '#ffd36b' : '#ffffff') : 'rgba(255,255,255,0.34)';
          const scale = active ? 1.1 : 1;
          return (
            <span key={i} style={{display: 'inline-block', margin: '0 5px', color,
              transform: `scale(${scale})`, transformOrigin: 'left center',
              fontWeight: isKw && spoken ? 900 : 800}}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Sóng âm theo voice — canh GIỮA, vùng 1/3 DƯỚI. Đối xứng 2 bên.
export const Waveform: React.FC<{src: string; color?: string}> = ({src, color = '#7fc8ff'}) => {
  const data = useAudioData(src);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!data) return null;
  const N = 32;
  const raw = visualizeAudio({fps, frame, audioData: data, numberOfSamples: N});
  // đối xứng: [đảo nửa] + [nửa] → dải sóng canh giữa
  const half = raw.slice(0, N / 2);
  const bars = [...half.slice().reverse(), ...half];
  return (
    <div style={{position: 'absolute', left: '50%', bottom: '9%', transform: 'translateX(-50%)',
      width: '46%', height: '13%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      pointerEvents: 'none'}}>
      {bars.map((v, i) => {
        const h = Math.max(4, Math.min(100, v * 420));
        return <div key={i} style={{width: 5, height: `${h}%`, borderRadius: 3,
          background: `linear-gradient(180deg, #cfeaff, ${color})`, opacity: 0.92,
          boxShadow: `0 0 8px ${color}66`}} />;
      })}
    </div>
  );
};

// Kinetic caption: hiện từng cụm, nhấn (phóng to + đổi màu) các keyword.
export const KineticCaption: React.FC<{text: string; keywords?: {text: string}[]}> = ({text, keywords}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const groups = chunkWords(text, 6);
  const per = durationInFrames / groups.length;
  const idx = Math.min(groups.length - 1, Math.floor(frame / per));
  const local = frame - idx * per;
  const appear = interpolate(local, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rise = interpolate(local, [0, 12], [18, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const kw = (keywords || []).flatMap((k) => clean(k.text).split(/\s+/));
  const words = groups[idx].split(' ');
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 78, paddingLeft: 80, paddingRight: 80}}>
      <div style={{opacity: appear, transform: `translateY(${rise}px)`, maxWidth: 1040, textAlign: 'center',
        fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 46, fontWeight: 800, lineHeight: 1.35,
        textShadow: '0 3px 16px rgba(0,0,0,.95)'}}>
        {words.map((w, i) => {
          const cw = clean(w);
          const isKw = cw.length > 1 && kw.some((k) => k && (cw.includes(k) || k.includes(cw)));
          const pulse = isKw ? 1 + 0.09 * Math.sin(Math.min(Math.PI, local * 0.22)) : 1;
          return (
            <span key={i} style={{display: 'inline-block', margin: '0 6px',
              color: isKw ? '#ffd36b' : '#ffffff', fontWeight: isKw ? 900 : 800,
              transform: `scale(${pulse})`}}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
