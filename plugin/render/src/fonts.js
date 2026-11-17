import { useEffect, useState } from 'react';
import { loadFont } from '@remotion/fonts';
import { staticFile, useDelayRender } from 'remotion';

// The bundled fallback font is always loaded; brand fonts are loaded on top.
// A font that fails to load never stops the render: the CSS stack falls back to Inter.
export function useBrandFonts(fonts) {
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    const jobs = [
      loadFont({ family: 'KitInter', url: staticFile('fonts/inter-latin-400-normal.woff2'), weight: '400' }),
      loadFont({ family: 'KitInter', url: staticFile('fonts/inter-latin-700-normal.woff2'), weight: '700' }),
      loadFont({ family: 'KitInter', url: staticFile('fonts/inter-latin-800-normal.woff2'), weight: '800' }),
      ...fonts.map((f) => loadFont({ family: f.family, url: f.url, weight: '100 900' }).catch((e) => console.warn('font failed', f.family, e))),
    ];
    Promise.all(jobs).catch((e) => console.warn('font load problem', e)).finally(() => continueRender(handle));
  }, [fonts, handle, continueRender]);
}
