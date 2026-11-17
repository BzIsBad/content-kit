// Safe area: a centred box that leaves 12% clear on the left and right, 8% at the top
// and 20% at the bottom (clears the Instagram and TikTok buttons, keeps captions centred).
export const SAFE_SIDE_PCT = 0.12;
export const SAFE_TOP_PCT = 0.08;
export const SAFE_BOTTOM_PCT = 0.2;

export function safeBox(width, height) {
  const left = width * SAFE_SIDE_PCT;
  const right = width * (1 - SAFE_SIDE_PCT);
  const top = height * SAFE_TOP_PCT;
  const bottom = height * (1 - SAFE_BOTTOM_PCT);
  // Text blocks are centred on the frame and wrap inside the safe width, with a little padding.
  const boxW = Math.round(right - left - width * 0.04);
  return { left, right, top, bottom, boxW, centerX: width / 2 };
}
