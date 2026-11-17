// Safe area: nothing in the bottom 20% or the right 12% of the frame.
export const SAFE_RIGHT_PCT = 0.12;
export const SAFE_BOTTOM_PCT = 0.2;

export function safeBox(width, height) {
  const right = width * (1 - SAFE_RIGHT_PCT);
  const bottom = height * (1 - SAFE_BOTTOM_PCT);
  // Text blocks are centred on the frame but must stay left of `right`.
  const half = Math.min(width / 2, right - width / 2) - width * 0.025;
  return { right, bottom, boxW: Math.round(half * 2), centerX: width / 2 };
}
