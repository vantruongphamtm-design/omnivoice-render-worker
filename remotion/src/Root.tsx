import React from 'react';
import {Composition} from 'remotion';
import {Presentation, PresentationProps} from './Presentation';
import {StoryVideo, StoryProps, storyDuration} from './StoryVideo';
import story from '../story.json';
import cinematic from '../story_cinematic.json';

const FPS = 30;

// Composition cũ (slide chữ, không ảnh) — nội dung từ story.json
const DEMO = story as PresentationProps;
const calcPres = ({props}: {props: PresentationProps}) => {
  const total = props.scenes.reduce((s, sc) => s + Math.max(1, sc.durationInFrames || FPS * 4), 0);
  return {durationInFrames: Math.max(1, total), fps: FPS, width: 1280, height: 720};
};

// Composition MỚI (cinematic: ảnh + camera + hiệu ứng theo cảm xúc) — story_cinematic.json
const CINE = cinematic as StoryProps;
const calcStory = ({props}: {props: StoryProps}) => ({
  durationInFrames: storyDuration(props.scenes), fps: FPS, width: 1280, height: 720,
});

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="StoryVideo"
        component={StoryVideo}
        durationInFrames={FPS * 27}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={CINE}
        calculateMetadata={calcStory}
      />
      <Composition
        id="Presentation"
        component={Presentation}
        durationInFrames={FPS * 27}
        fps={FPS}
        width={1280}
        height={720}
        defaultProps={DEMO}
        calculateMetadata={calcPres}
      />
    </>
  );
};
