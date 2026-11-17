import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { safeBox } from './safe.js';

const fade = (frame, dur, edge = 6) =>
  interpolate(frame, [0, edge, Math.max(edge + 1, dur - edge), dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

const yFor = (position, height) => ({ top: height * 0.1, center: height * 0.4, bottom: height * 0.62 }[position] ?? height * 0.08);

export const HookTitle = ({ hook, theme }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { boxW } = safeBox(width, height);
  const lift = interpolate(frame, [0, 8], [24, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: (width - boxW) / 2, width: boxW, top: height * 0.17, opacity: fade(frame, hook.durationFrames, 8), transform: `translateY(${lift}px)`, display: 'flex', justifyContent: 'center' }}>
      <div style={{ background: theme.colors.primary, color: theme.colors.text, fontFamily: theme.headlineFont, fontWeight: 800, fontSize: height * 0.042, lineHeight: 1.2, textAlign: 'center', padding: `${height * 0.014}px ${width * 0.035}px`, borderRadius: height * 0.012, borderBottom: `${height * 0.005}px solid ${theme.colors.accent}`, boxShadow: '0 8px 30px rgba(0,0,0,0.35)', overflowWrap: 'anywhere' }}>
        {hook.text}
      </div>
    </div>
  );
};

export const OverlayItem = ({ overlay, theme }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { boxW } = safeBox(width, height);
  const top = yFor(overlay.position, height);
  const wrap = { position: 'absolute', left: (width - boxW) / 2, width: boxW, top, display: 'flex', justifyContent: 'center', opacity: fade(frame, overlay.durationFrames) };
  if (overlay.type === 'image') {
    return <div style={wrap}><Img src={overlay.url} style={{ maxWidth: boxW * 0.8, maxHeight: height * 0.2, objectFit: 'contain' }} /></div>;
  }
  return (
    <div style={wrap}>
      <div style={{ fontFamily: theme.bodyFont, fontWeight: 700, fontSize: height * 0.034, lineHeight: 1.25, textAlign: 'center', color: theme.colors.text, background: 'rgba(0,0,0,0.45)', padding: `${height * 0.01}px ${width * 0.03}px`, borderRadius: height * 0.01, overflowWrap: 'anywhere' }}>
        {overlay.text}
      </div>
    </div>
  );
};

export const Watermark = ({ watermark }) => {
  const { width, height } = useVideoConfig();
  const { right } = safeBox(width, height);
  const w = width * (watermark.sizePct || 18) / 100;
  const m = width * 0.04;
  const pos = { position: 'absolute', width: w, opacity: watermark.opacity };
  const c = watermark.corner;
  if (c.endsWith('right')) pos.left = right - m - w; else pos.left = m;
  if (c.startsWith('top')) pos.top = height * 0.04; else pos.bottom = height * 0.2 + height * 0.02; // stays above the bottom 20%
  return <Img src={watermark.url} style={{ ...pos, height: 'auto', maxHeight: w * 0.9, objectFit: 'contain' }} />;
};

export const EndCard = ({ endCard, theme }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { boxW } = safeBox(width, height);
  const o = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const { primary, accent, text } = theme.colors;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${primary} 0%, ${primary} 60%, ${accent}33 100%)`, opacity: o }}>
      <div style={{ position: 'absolute', left: (width - boxW) / 2, width: boxW, top: height * 0.22, height: height * 0.5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: height * 0.035 }}>
        {endCard.logoUrl ? (
          <Img src={endCard.logoUrl} style={{ width: boxW * 0.7, maxHeight: height * 0.2, objectFit: 'contain' }} />
        ) : (
          <div style={{ fontFamily: theme.headlineFont, fontWeight: 800, fontSize: height * 0.06, lineHeight: 1.1, color: text, textAlign: 'center', overflowWrap: 'anywhere' }}>{theme.name}</div>
        )}
        <div style={{ width: boxW * 0.25, height: height * 0.004, background: accent, borderRadius: 4 }} />
        {endCard.cta ? (
          <div style={{ background: accent, color: theme.onAccent, fontFamily: theme.headlineFont, fontWeight: 800, fontSize: height * 0.034, lineHeight: 1.25, textAlign: 'center', padding: `${height * 0.016}px ${width * 0.04}px`, borderRadius: height * 0.02, overflowWrap: 'anywhere' }}>{endCard.cta}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
