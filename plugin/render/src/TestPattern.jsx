import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { safeBox } from './safe.js';

// Stand-in for footage in the smoke test: brand colours, font samples,
// a moving bar (so you can see motion) and a dashed line marking the safe area.
// The caption zone (about 58% to 78% of the height) is kept clear on purpose.
export const TestPattern = ({ theme }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { right, bottom } = safeBox(width, height);
  const c = theme.colors;
  const swatches = [['primary', c.primary], ['secondary', c.secondary], ['accent', c.accent], ['text', c.text], ['outline', c.textOutline]];
  const gap = width * 0.015;
  const sw = (right - width * 0.08 - gap * 4) / 5;
  const barW = width * 0.2;
  const x = (frame * 14) % (right - width * 0.08 - barW);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${c.primary}, #101010)` }}>
      <div style={{ position: 'absolute', left: width * 0.04, top: height * 0.33, display: 'flex', gap }}>
        {swatches.map(([name, hex]) => (
          <div key={name} style={{ width: sw, textAlign: 'center', fontFamily: theme.bodyFont, fontWeight: 700, fontSize: height * 0.0135, color: '#fff' }}>
            <div style={{ height: height * 0.06, background: hex, border: '2px solid rgba(255,255,255,0.55)', borderRadius: 8, marginBottom: 8 }} />
            {name}<br />{hex}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: width * 0.04, top: height * 0.435, color: c.text, fontFamily: theme.headlineFont, fontWeight: 800, fontSize: height * 0.027 }}>
        Headline font: {theme.headlineFamily && (theme.headlineLoaded || /^inter$/i.test(theme.headlineFamily)) ? theme.headlineFamily : theme.headlineFamily ? `${theme.headlineFamily} (stand-in)` : 'built-in Inter'}
      </div>
      <div style={{ position: 'absolute', left: width * 0.04, top: height * 0.475, color: c.text, fontFamily: theme.bodyFont, fontWeight: 400, fontSize: height * 0.026 }}>
        Body font: {theme.bodyFamily && (theme.bodyLoaded || /^inter$/i.test(theme.bodyFamily)) ? theme.bodyFamily : theme.bodyFamily ? `${theme.bodyFamily} (stand-in)` : 'built-in Inter'}
      </div>
      <div style={{ position: 'absolute', left: width * 0.04 + x, top: height * 0.53, width: barW, height: 12, borderRadius: 6, background: c.accent }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: right, height: bottom, border: `3px dashed ${c.secondary}66`, boxSizing: 'border-box' }} />
      <div style={{ position: 'absolute', left: width * 0.04, top: bottom - height * 0.035, color: `${c.secondary}cc`, fontFamily: theme.bodyFont, fontWeight: 700, fontSize: height * 0.015 }}>
        dashed line = safe area{[[theme.headlineFamily, theme.headlineLoaded], [theme.bodyFamily, theme.bodyLoaded]].some(([f, l]) => f && !l && !/^inter$/i.test(f)) ? ' · stand-in until the font file is added' : ''}
      </div>
    </AbsoluteFill>
  );
};
