import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {TransitionPresentation, TransitionPresentationComponentProps} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {wipe} from '@remotion/transitions/wipe';
import {TransitionKind} from './presets';

type P = Record<string, never>;
type CProps = TransitionPresentationComponentProps<P>;

const LinearBlur: React.FC<CProps> = ({children, presentationDirection, presentationProgress}) => {
  const entering = presentationDirection === 'entering';
  const p = presentationProgress;
  const blur = entering ? (1 - p) * 14 : p * 14;
  const opacity = entering ? p : 1 - p;
  return <AbsoluteFill style={{opacity, filter: `blur(${blur}px)`}}>{children}</AbsoluteFill>;
};

const FilmBurn: React.FC<CProps> = ({children, presentationDirection, presentationProgress}) => {
  const entering = presentationDirection === 'entering';
  const p = presentationProgress;
  const opacity = entering ? interpolate(p, [0, 0.5, 1], [0, 0.45, 1]) : interpolate(p, [0, 0.5, 1], [1, 0.45, 0]);
  const burn = entering ? 1 - p : p;
  return (
    <AbsoluteFill style={{opacity}}>
      {children}
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 50% 55%, rgba(255,170,60,${burn * 0.7}), rgba(255,90,20,${burn * 0.32}) 60%, transparent 82%)`,
        mixBlendMode: 'screen', pointerEvents: 'none',
      }} />
    </AbsoluteFill>
  );
};

const DreamyZoom: React.FC<CProps> = ({children, presentationDirection, presentationProgress}) => {
  const entering = presentationDirection === 'entering';
  const p = presentationProgress;
  const scale = entering ? interpolate(p, [0, 1], [1.25, 1]) : interpolate(p, [0, 1], [1, 1.12]);
  const opacity = entering ? p : 1 - p;
  const flash = entering ? (1 - p) * 0.4 : 0;
  return (
    <AbsoluteFill style={{opacity, transform: `scale(${scale})`}}>
      {children}
      {flash > 0 ? <AbsoluteFill style={{background: '#fff', opacity: flash, pointerEvents: 'none'}} /> : null}
    </AbsoluteFill>
  );
};

const PushCut: React.FC<CProps> = ({children, presentationDirection, presentationProgress}) => {
  const entering = presentationDirection === 'entering';
  const p = presentationProgress;
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const x = entering ? interpolate(ease, [0, 1], [14, 0]) : interpolate(ease, [0, 1], [0, -14]);
  const opacity = entering ? interpolate(p, [0, 0.25, 1], [0, 1, 1]) : interpolate(p, [0, 0.75, 1], [1, 1, 0]);
  const flash = entering && p < 0.18 ? 0.5 : 0;
  return (
    <AbsoluteFill style={{opacity, transform: `translateX(${x}%)`}}>
      {children}
      {flash > 0 ? <AbsoluteFill style={{background: '#fff', opacity: flash, pointerEvents: 'none'}} /> : null}
    </AbsoluteFill>
  );
};

const CrossZoom: React.FC<CProps> = ({children, presentationDirection, presentationProgress}) => {
  const entering = presentationDirection === 'entering';
  const p = presentationProgress;
  const scale = entering ? interpolate(p, [0, 1], [1.3, 1]) : interpolate(p, [0, 1], [1, 1.3]);
  const opacity = entering ? p : 1 - p;
  const blur = (entering ? 1 - p : p) * 6;
  return <AbsoluteFill style={{opacity, transform: `scale(${scale})`, filter: `blur(${blur}px)`}}>{children}</AbsoluteFill>;
};

const custom = (Comp: React.FC<CProps>): TransitionPresentation<P> => ({component: Comp, props: {}});

export const pickTransition = (kind?: TransitionKind): TransitionPresentation<any> => {
  switch (kind) {
    case 'filmBurn': return custom(FilmBurn);
    case 'dreamyZoom': return custom(DreamyZoom);
    case 'pushCut': return custom(PushCut);
    case 'crossZoom': return custom(CrossZoom);
    case 'linearBlur': return custom(LinearBlur);
    case 'wipe': return wipe();
    case 'dissolve':
    case 'fade':
    default: return fade();
  }
};

// Số frame cho từng loại transition (pushCut nhanh, filmBurn/dreamy dài hơn).
export const transitionFrames = (kind?: TransitionKind): number => {
  switch (kind) {
    case 'pushCut': return 8;
    case 'filmBurn': return 20;
    case 'dreamyZoom': return 18;
    case 'crossZoom': return 14;
    default: return 12;
  }
};
