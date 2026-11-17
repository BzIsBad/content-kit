import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { safeBox } from './safe.js';

// Stand-in for footage in the smoke test: brand colours, font samples, a moving bar (so you
// can see motion) and a dashed line marking the safe area. Everything sits inside the dashed
// line. The layout keeps out of the way of the hook title (top), the overlay text and the
// captions, wherever the brand puts them, by filling only the free bands of the frame.
const stands = (family, loaded) => family && !loaded && !/^inter$/i.test(family);

export const TestPattern = ({ theme, captions }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { left, right, top, bottom } = safeBox(width, height);
  const c = theme.colors;
  const pad = width * 0.025;
  const innerL = left + pad;
  const innerW = right - left - pad * 2;
  const gap = Math.round(height * 0.011);
  const estLines = (text, size) => Math.max(1, Math.ceil((text.length * size * 0.64) / innerW));

  const fontText = (label, family, loaded) =>
    `${label}: ${family && (loaded || /^inter$/i.test(family)) ? family : family ? `${family} (stand-in)` : 'built-in Inter'}`;
  const withNoBreak = (t) => { const i = t.indexOf('(stand-in)'); return i < 0 ? t : <>{t.slice(0, i)}<span style={{ whiteSpace: 'nowrap' }}>(stand-in)</span></>; };
  const hText = fontText('Headline font', theme.headlineFamily, theme.headlineLoaded);
  const bText = fontText('Body font', theme.bodyFamily, theme.bodyLoaded);
  const anyStandIn = stands(theme.headlineFamily, theme.headlineLoaded) || stands(theme.bodyFamily, theme.bodyLoaded);
  const footText = `Words stay inside the dashed line so app buttons never cover them.${anyStandIn ? ' "Stand-in" means a backup font is showing until your font file is added.' : ''}`;
  const footSize = height * 0.0125;
  const footH = estLines(footText, footSize * 0.9) * footSize * 1.3;
  const footTop = bottom - pad - footH;

  // Where captions will be (worst case two lines), so nothing else is drawn there.
  let capBand = null;
  if (captions && captions.style !== 'none') {
    const size = (height * (captions.fontSizePct || 5.5)) / 100;
    const h = 2 * size * 1.18 + size * 0.25;
    const bottomEdge = captions.position === 'center' ? height * 0.5 + h / 2 : height * 0.73;
    capBand = [bottomEdge - h, bottomEdge];
  }
  const y0 = height * 0.335; // below the hook title (two lines) and the top overlay text
  const g2 = height * 0.014;
  const bands = capBand ? [[y0, capBand[0] - g2], [capBand[1] + g2, footTop - g2]] : [[y0, footTop - g2]];

  const swatches = [['primary', c.primary], ['secondary', c.secondary], ['accent', c.accent], ['text', c.text], ['outline', c.textOutline]];
  const tryLayout = (s) => {
    const swFont = height * 0.0125 * s;
    const cols = (innerW - 4 * gap * s) / 5 >= 9 * swFont * 0.66 + 8 ? 5 : 3;
    const rows = Math.ceil(5 / cols);
    const sh = height * 0.038 * s;
    const swH = rows * (sh + 8 + 2 * swFont * 1.25) + (rows - 1) * gap;
    const fs = height * 0.026 * s;
    const hH = estLines(hText, fs) * fs * 1.25;
    const bH = estLines(bText, fs * 0.95) * fs * 0.95 * 1.25;
    const blocks = [
      { k: 'sw', h: swH }, { k: 'h', h: hH }, { k: 'b', h: bH }, { k: 'bar', h: 14 + gap },
    ];
    const placed = {};
    let band = 0;
    let cur = bands[0][0];
    for (const b of blocks) {
      while (band < bands.length && cur + b.h > bands[band][1]) { band += 1; if (band < bands.length) cur = bands[band][0]; }
      if (band >= bands.length) return null;
      placed[b.k] = cur;
      cur += b.h + gap * s;
    }
    return { placed, s, swFont, cols, sh, fs, gapS: gap * s };
  };
  let L = null;
  for (const s of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) { L = tryLayout(s); if (L) break; }
  if (!L) L = tryLayout(0.5) || { placed: { sw: y0, h: y0 + 150, b: y0 + 200, bar: y0 + 260 }, s: 0.5, swFont: height * 0.0063, cols: 3, sh: height * 0.019, fs: height * 0.013, gapS: gap / 2 };

  const swW = (innerW - (L.cols - 1) * L.gapS) / L.cols;
  const barW = width * 0.18;
  const x = (frame * 14) % (innerW - barW);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${c.primary}, #101010)` }}>
      <div style={{ position: 'absolute', left: innerL, top: L.placed.sw, width: innerW, display: 'flex', flexWrap: 'wrap', gap: L.gapS }}>
        {swatches.map(([name, hex]) => (
          <div key={name} style={{ width: swW, textAlign: 'center', fontFamily: theme.bodyFont, fontWeight: 700, fontSize: L.swFont, lineHeight: 1.25, color: '#fff' }}>
            <div style={{ height: L.sh, background: hex, border: '2px solid rgba(255,255,255,0.55)', borderRadius: 8, marginBottom: 8 }} />
            {name}<br />{hex}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: innerL, top: L.placed.h, width: innerW, color: c.text, fontFamily: theme.headlineFont, fontWeight: 800, fontSize: L.fs, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{withNoBreak(hText)}</div>
      <div style={{ position: 'absolute', left: innerL, top: L.placed.b, width: innerW, color: c.text, fontFamily: theme.bodyFont, fontWeight: 400, fontSize: L.fs * 0.95, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{withNoBreak(bText)}</div>
      <div style={{ position: 'absolute', left: innerL + x, top: L.placed.bar + gap * 0.6, width: barW, height: 14, borderRadius: 7, background: c.accent }} />
      <div style={{ position: 'absolute', left: left, top, width: right - left, height: bottom - top, border: `3px dashed ${c.secondary}99`, boxSizing: 'border-box' }} />
      <div style={{ position: 'absolute', left: innerL, top: footTop, width: innerW, color: `${c.secondary}f2`, fontFamily: theme.bodyFont, fontWeight: 700, fontSize: footSize, lineHeight: 1.3 }}>{footText}</div>
    </AbsoluteFill>
  );
};
