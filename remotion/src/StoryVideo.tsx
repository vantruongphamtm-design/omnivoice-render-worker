import React from 'react';
import {AbsoluteFill, Audio, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {CameraImage, FilmGrain, Vignette, FlashHit, KaraokeCaption, Waveform} from './effects';
import {getPreset, applyIntensity, MOOD_GRADE, CameraKind, Mood, TransitionKind} from './presets';
import {pickTransition, transitionFrames} from './transitions';

export type StoryScene = {
  text?: string;
  imageUrl?: string | null;
  preset?: string;
  camera?: CameraKind;
  mood?: Mood;
  transition?: TransitionKind;
  intensity?: number;
  keywords?: {text: string; importance?: number; effect?: string}[];
  audioUrl?: string | null;
  durationInFrames: number;
};

export type StoryProps = {
  title: string;
  bgmUrl?: string | null;
  scenes: StoryScene[];
};

const GradientBg: React.FC<{grade: string}> = ({grade}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const t = durationInFrames > 0 ? frame / durationInFrames : 0;
  const x = 30 + 30 * Math.sin(t * Math.PI * 2);
  const y = 25 + 25 * Math.cos(t * Math.PI * 2);
  return (
    <AbsoluteFill style={{
      filter: grade === 'none' ? undefined : grade,
      background: `radial-gradient(900px 700px at ${x}% ${y}%, rgba(76,154,255,.25), transparent 60%),
                   radial-gradient(900px 700px at ${100 - x}% ${100 - y}%, rgba(156,107,255,.22), transparent 60%),
                   radial-gradient(1200px 800px at 50% 0%, #1a2b4d, #0c1424)`,
    }} />
  );
};

const SceneView: React.FC<{scene: StoryScene}> = ({scene}) => {
  const base = getPreset(scene.preset);
  const camera: CameraKind = scene.camera || base.camera;
  const mood: Mood = scene.mood || base.mood;
  const eff = applyIntensity({...base, camera}, scene.intensity ?? 0.4);
  const grade = MOOD_GRADE[mood];
  return (
    <AbsoluteFill>
      {scene.imageUrl
        ? <CameraImage image={scene.imageUrl} camera={camera} grade={grade} shake={eff.shake} />
        : <GradientBg grade={grade} />}
      <Vignette strength={eff.vignette} />
      {base.flash ? <FlashHit atFrame={2} /> : null}
      {scene.text ? <KaraokeCaption text={scene.text} keywords={scene.keywords} /> : null}
      {scene.audioUrl ? <Waveform src={scene.audioUrl} /> : null}
      {scene.audioUrl ? <Audio src={scene.audioUrl} /> : null}
    </AbsoluteFill>
  );
};

export const StoryVideo: React.FC<StoryProps> = ({scenes, bgmUrl}) => {
  return (
    <AbsoluteFill style={{backgroundColor: '#0a0f1a'}}>
      <TransitionSeries>
        {scenes.map((sc, i) => {
          const items: React.ReactNode[] = [
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={sc.durationInFrames}>
              <SceneView scene={sc} />
            </TransitionSeries.Sequence>,
          ];
          if (i < scenes.length - 1) {
            const next = scenes[i + 1];
            const tk: TransitionKind = next.transition || getPreset(next.preset).transition;
            items.push(
              <TransitionSeries.Transition
                key={`t${i}`}
                presentation={pickTransition(tk)}
                timing={linearTiming({durationInFrames: transitionFrames(tk)})}
              />,
            );
          }
          return items;
        })}
      </TransitionSeries>
      {bgmUrl ? <Audio src={bgmUrl} volume={0.14} loop /> : null}
      <FilmGrain opacity={0.05} />
    </AbsoluteFill>
  );
};

// Tổng số frame (TransitionSeries trừ đi phần overlap của mỗi transition).
export const storyDuration = (scenes: StoryScene[]): number => {
  const sum = scenes.reduce((s, sc) => s + Math.max(1, sc.durationInFrames), 0);
  let overlap = 0;
  for (let i = 1; i < scenes.length; i++) {
    const tk = scenes[i].transition || getPreset(scenes[i].preset).transition;
    overlap += transitionFrames(tk);
  }
  return Math.max(1, sum - overlap);
};
