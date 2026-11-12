// A noise gate for the microphone's level meter (display only; the recording is untouched).
//
// Chromium's automatic gain control turns a quiet microphone up, so room noise alone reads as a
// steady level and the meter moves while nobody speaks. The gate follows that background: it
// drops to any quieter level at once and creeps up only slowly, so speech (which has pauses)
// never becomes the floor. What it returns is the level above the background.

const RISE_PER_SAMPLE = 0.0005;   // at ~15 samples a second the floor takes minutes to catch up
const MARGIN = 1.6;               // the background wobbles; ignore that much above its floor

export function createNoiseGate({ rise = RISE_PER_SAMPLE, margin = MARGIN } = {}) {
  let floor = null;
  return (level) => {
    if (floor === null || level < floor) floor = level;
    else floor += (level - floor) * rise;
    return Math.max(0, level - floor * margin);
  };
}
