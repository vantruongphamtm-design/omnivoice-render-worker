import React from 'react';
import {
  AbsoluteFill, Sequence, Audio, Img, useCurrentFrame, useVideoConfig, interpolate,
} from 'remotion';

export type Scene = {
  layout: 'title' | 'bullets' | 'stats' | 'quote' | 'story';
  title?: string;
  subtitle?: string;
  author?: string;
  quote?: string;
  bullets?: string[];
  stats?: {value: string; label: string}[];
  bg?: string | null;         // ảnh nền CỦA BẠN (không phải ảnh AI) — Ken Burns
  audioUrl?: string | null;   // giọng OmniVoice cho cảnh này
  durationInFrames: number;
};

export type PresentationProps = {
  title: string;
  bgmUrl?: string | null;
  scenes: Scene[];
};

const THEME = {
  bg: '#12203A', card: '#1B2E4F', text: '#F1F6FF', muted: '#C3D0E6',
  primary: '#4C9AFF', accent: '#9C6BFF', ok: '#39C077',
};
const FONT = "'Segoe UI', Arial, sans-serif";

// Nền ảnh với Ken Burns (zoom + pan chậm) + lớp phủ tối cho chữ dễ đọc.
const KenBurns: React.FC<{src: string; dim?: number}> = ({src, dim = 0.45}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.16], {extrapolateRight: 'clamp'});
  const x = interpolate(frame, [0, durationInFrames], [-12, 12], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{transform: `scale(${scale}) translateX(${x}px)`}}>
        <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      </AbsoluteFill>
      <AbsoluteFill style={{background: `linear-gradient(180deg, rgba(6,12,26,${dim*0.7}), rgba(6,12,26,${dim}))`}} />
    </AbsoluteFill>
  );
};

const Fade: React.FC<{durationInFrames: number; children: React.ReactNode}> = ({durationInFrames, children}) => {
  const frame = useCurrentFrame();
  const fade = 14;
  const opacity = interpolate(
    frame, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
};

const Header: React.FC<{title?: string; subtitle?: string}> = ({title, subtitle}) => (
  <div>
    <div style={{fontSize: 46, fontWeight: 800}}>{title}</div>
    {subtitle ? <div style={{fontSize: 26, color: THEME.muted, marginTop: 10}}>{subtitle}</div> : null}
    <div style={{height: 5, width: 90, background: THEME.primary, borderRadius: 3, marginTop: 18}} />
  </div>
);

const Slide: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 18], [24, 0], {extrapolateRight: 'clamp'});
  const base: React.CSSProperties = {
    fontFamily: FONT, color: THEME.text, padding: '70px 90px', transform: `translateY(${rise}px)`,
  };

  // STORY: lời kể hiện chữ lớn, canh giữa, có bóng chữ — hợp video kể chuyện.
  if (scene.layout === 'story') {
    return (
      <AbsoluteFill style={{
        fontFamily: FONT, color: '#fff', padding: '90px 110px',
        justifyContent: 'flex-end', alignItems: 'center', textAlign: 'center',
        transform: `translateY(${rise}px)`,
      }}>
        {scene.subtitle ? (
          <div style={{fontSize: 24, letterSpacing: 3, textTransform: 'uppercase',
            color: THEME.accent, marginBottom: 22, textShadow: '0 2px 10px rgba(0,0,0,.8)'}}>
            {scene.subtitle}
          </div>
        ) : null}
        <div style={{fontSize: 50, fontWeight: 700, lineHeight: 1.45, maxWidth: 1050,
          textShadow: '0 3px 16px rgba(0,0,0,.9)'}}>
          {scene.title}
        </div>
      </AbsoluteFill>
    );
  }

  if (scene.layout === 'title') {
    return (
      <AbsoluteFill style={{...base, justifyContent: 'center', alignItems: 'center', textAlign: 'center'}}>
        <div style={{fontSize: 70, fontWeight: 800, lineHeight: 1.15,
          textShadow: scene.bg ? '0 3px 16px rgba(0,0,0,.9)' : 'none',
          color: scene.bg ? '#fff' : undefined,
          background: scene.bg ? undefined : `linear-gradient(90deg,${THEME.primary},${THEME.accent})`,
          WebkitBackgroundClip: scene.bg ? undefined : 'text',
          WebkitTextFillColor: scene.bg ? undefined : 'transparent'}}>
          {scene.title}
        </div>
        {scene.subtitle ? <div style={{fontSize: 30, color: scene.bg ? '#e7eefc' : THEME.muted, marginTop: 26,
          textShadow: scene.bg ? '0 2px 10px rgba(0,0,0,.8)' : 'none'}}>{scene.subtitle}</div> : null}
        {scene.author ? <div style={{fontSize: 20, color: THEME.muted, marginTop: 40, opacity: .85}}>{scene.author}</div> : null}
      </AbsoluteFill>
    );
  }

  if (scene.layout === 'quote') {
    return (
      <AbsoluteFill style={{...base, justifyContent: 'center'}}>
        <div style={{fontSize: 90, color: THEME.accent, lineHeight: .5}}>&ldquo;</div>
        <div style={{fontSize: 44, fontWeight: 700, lineHeight: 1.35, maxWidth: 980,
          textShadow: scene.bg ? '0 3px 16px rgba(0,0,0,.9)' : 'none'}}>{scene.quote}</div>
        {scene.author ? <div style={{fontSize: 24, color: THEME.muted, marginTop: 30}}>— {scene.author}</div> : null}
      </AbsoluteFill>
    );
  }

  if (scene.layout === 'stats') {
    return (
      <AbsoluteFill style={base}>
        <Header title={scene.title} subtitle={scene.subtitle} />
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 26, marginTop: 40}}>
          {(scene.stats || []).slice(0, 4).map((s, i) => (
            <div key={i} style={{background: THEME.card, borderRadius: 18, padding: '30px 34px'}}>
              <div style={{fontSize: 56, fontWeight: 800, color: i % 2 ? THEME.accent : THEME.primary}}>{s.value}</div>
              <div style={{fontSize: 24, color: THEME.muted, marginTop: 8}}>{s.label}</div>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  // bullets
  return (
    <AbsoluteFill style={base}>
      <Header title={scene.title} subtitle={scene.subtitle} />
      <div style={{marginTop: 40, display: 'flex', flexDirection: 'column', gap: 22}}>
        {(scene.bullets || []).map((b, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 18, fontSize: 32}}>
            <div style={{width: 14, height: 14, borderRadius: 4, marginTop: 12,
              background: i % 2 ? THEME.accent : THEME.primary, flexShrink: 0}} />
            <div style={{lineHeight: 1.4}}>{b}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// Nền động cho video chữ (không ảnh): 2 khối sáng trôi chậm + gradient nền.
const AnimatedBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const t = durationInFrames > 0 ? frame / durationInFrames : 0;
  const x1 = 20 + 25 * Math.sin(t * Math.PI * 2);
  const y1 = 10 + 20 * Math.cos(t * Math.PI * 2);
  const x2 = 80 - 20 * Math.sin(t * Math.PI * 2 + 1.2);
  const y2 = 85 - 18 * Math.cos(t * Math.PI * 2 + 0.6);
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(900px 700px at ${x1}% ${y1}%, rgba(76,154,255,.22), transparent 60%),
                   radial-gradient(900px 700px at ${x2}% ${y2}%, rgba(156,107,255,.20), transparent 60%),
                   radial-gradient(1200px 800px at 50% 0%, #1a2b4d, ${THEME.bg})`,
    }} />
  );
};

export const Presentation: React.FC<PresentationProps> = ({scenes, bgmUrl}) => {
  let from = 0;
  return (
    <AbsoluteFill style={{background: THEME.bg}}>
      <AnimatedBackdrop />
      {bgmUrl ? <Audio src={bgmUrl} volume={0.16} loop /> : null}
      {scenes.map((sc, i) => {
        const seq = (
          <Sequence key={i} from={from} durationInFrames={sc.durationInFrames}>
            <Fade durationInFrames={sc.durationInFrames}>
              {sc.bg ? <KenBurns src={sc.bg} /> : null}
              <Slide scene={sc} />
            </Fade>
            {sc.audioUrl ? <Audio src={sc.audioUrl} /> : null}
          </Sequence>
        );
        from += sc.durationInFrames;
        return seq;
      })}
    </AbsoluteFill>
  );
};
