import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio, Video } from '@remotion/media';
import { useBrandFonts } from './fonts.js';
import { Captions } from './Captions.jsx';
import { EndCard, HookTitle, OverlayItem, Watermark } from './Overlays.jsx';
import { TestPattern } from './TestPattern.jsx';

const SourceClip = ({ seg }) => {
  const common = { src: seg.url, trimBefore: seg.trimBeforeFrames };
  if (seg.framing === 'blur-fit') {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        {/* Each layer fills the frame on its own; in one flex column they split it into halves. */}
        <AbsoluteFill>
          <Video {...common} muted objectFit="cover" style={{ width: '100%', height: '100%', filter: 'blur(38px) brightness(0.55)', transform: 'scale(1.15)' }} />
        </AbsoluteFill>
        <AbsoluteFill>
          <Video {...common} objectFit="contain" style={{ width: '100%', height: '100%' }} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  // crop-center: fill the frame; cropX picks the horizontal centre of the crop.
  return <Video {...common} objectFit="cover" style={{ width: '100%', height: '100%', objectPosition: `${seg.cropX * 100}% 50%` }} />;
};

const Music = ({ music }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const fadeOut = interpolate(frame, [durationInFrames - fps, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <Audio src={music.url} loop volume={music.volume * fadeOut} />;
};

export const Reel = ({ plan }) => {
  useBrandFonts(plan.fonts);
  const { theme } = plan;
  const contentEnd = plan.endCard ? plan.endCard.startFrame : plan.durationInFrames;
  const fps = plan.fps;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {plan.segments.map((seg, i) => (
        <Sequence key={i} from={seg.startFrame} durationInFrames={seg.durationFrames} premountFor={fps} name={`Clip ${i + 1}`}>
          {seg.kind === 'pattern' ? <TestPattern theme={theme} captions={plan.captions} /> : <SourceClip seg={seg} />}
        </Sequence>
      ))}
      <Sequence from={0} durationInFrames={contentEnd} name="Overlays" layout="none">
        {plan.watermark ? <Watermark watermark={plan.watermark} /> : null}
        {plan.overlays.map((o, i) => (
          <Sequence key={i} from={o.startFrame} durationInFrames={o.durationFrames} name={`Overlay ${i + 1}`}><OverlayItem overlay={o} theme={theme} /></Sequence>
        ))}
        {plan.hook ? <Sequence from={plan.hook.startFrame} durationInFrames={plan.hook.durationFrames} name="Hook title"><HookTitle hook={plan.hook} theme={theme} /></Sequence> : null}
        <Captions captions={plan.captions} theme={theme} />
      </Sequence>
      {plan.endCard ? (
        <Sequence from={plan.endCard.startFrame} durationInFrames={plan.endCard.durationFrames} name="End card"><EndCard endCard={plan.endCard} theme={theme} /></Sequence>
      ) : null}
      {plan.music ? <Music music={plan.music} /> : null}
    </AbsoluteFill>
  );
};
