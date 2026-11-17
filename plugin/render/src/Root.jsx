import React from 'react';
import { Composition } from 'remotion';
import { Reel } from './Reel.jsx';

// Everything the video needs arrives as one resolved "plan" (see lib/plan.mjs).
const empty = {
  mode: 'reel', width: 1080, height: 1920, fps: 30, durationInFrames: 30,
  theme: {
    name: 'Preview', colors: { primary: '#1F2A44', secondary: '#F4EDE4', accent: '#E0703A', text: '#FFFFFF', textOutline: '#000000' },
    onAccent: '#FFFFFF', headlineFont: '"KitInter", sans-serif', bodyFont: '"KitInter", sans-serif',
  },
  fonts: [], segments: [], captions: { style: 'none', pages: [] }, watermark: null, hook: null, overlays: [], music: null, endCard: null,
};

export const Root = () => (
  <Composition
    id="Reel"
    component={Reel}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={{ plan: empty }}
    calculateMetadata={({ props }) => ({
      width: props.plan.width, height: props.plan.height, fps: props.plan.fps, durationInFrames: props.plan.durationInFrames,
    })}
  />
);
