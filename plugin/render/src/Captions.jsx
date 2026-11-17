import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { measureText } from '@remotion/layout-utils';
import { safeBox } from './safe.js';

const cache = new Map();

// Choose a font size so the caption page fits in at most two lines inside the safe box.
function fitSize({ text, family, base, boxW, weight }) {
  const key = `${text}|${family}|${base}|${boxW}`;
  if (cache.has(key)) return cache.get(key);
  const w = (t, size) => measureText({ text: t, fontFamily: family, fontSize: size, fontWeight: weight, validateFontIsLoaded: false }).width;
  let size = base;
  const longest = text.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
  for (let i = 0; i < 14; i++) {
    const lines = Math.ceil(w(text, size) / (boxW * 0.78));
    if (lines <= 2 && w(longest, size) <= boxW * 0.96) break;
    size *= 0.93;
  }
  size = Math.max(size, base * 0.45);
  cache.set(key, size);
  return size;
}

export const Captions = ({ captions, theme }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { pages, style, position, uppercase, fontSizePct } = captions;
  const page = useMemo(() => pages, [pages]).find((p) => frame >= p.startFrame && frame < p.endFrame);
  const { boxW } = safeBox(width, height);
  const base = (height * fontSizePct) / 100;
  const text = page ? page.words.map((w) => (uppercase ? w.text.toUpperCase() : w.text)).join(' ') : '';
  const size = page ? fitSize({ text, family: theme.headlineFont, base, boxW, weight: 800 }) : base;
  if (!page || style === 'none') return null;

  let activeIdx = 0;
  page.words.forEach((w, i) => { if (frame >= w.startFrame) activeIdx = i; });

  const outline = theme.colors.textOutline;
  const box = {
    position: 'absolute', left: (width - boxW) / 2, width: boxW, textAlign: 'center',
    fontFamily: theme.headlineFont, fontWeight: 800, fontSize: size, lineHeight: 1.18,
    color: theme.colors.text, WebkitTextStroke: `${Math.max(2, size * 0.09)}px ${outline}`, paintOrder: 'stroke fill',
    textShadow: `0 ${size * 0.05}px ${size * 0.2}px rgba(0,0,0,0.45)`, overflowWrap: 'anywhere', textWrap: 'balance',
  };
  if (position === 'center') { box.top = height * 0.5; box.transform = 'translateY(-50%)'; }
  else { box.bottom = height * (1 - 0.73); } // block bottom edge at 73% of height, clear of the 80% line

  return (
    <div style={box}>
      {page.words.map((w, i) => {
        const shown = uppercase ? w.text.toUpperCase() : w.text;
        const active = style === 'word-highlight' && i === activeIdx;
        return (
          <React.Fragment key={i}>
            <span style={{ display: 'inline-block', margin: '0 0.08em', color: active ? theme.colors.accent : theme.colors.text, transform: active ? 'scale(1.08)' : 'none' }}>{shown}</span>
            {i < page.words.length - 1 ? ' ' : ''}
          </React.Fragment>
        );
      })}
    </div>
  );
};
