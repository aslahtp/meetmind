/**
 * Host operating system, from the preload bridge. Not to be confused with lib/platform.js,
 * which is about meeting platforms (Meet, Zoom, Teams).
 */
export const OS = (typeof window !== 'undefined' && window.meetmind?.platform) || 'win32';

export const isMac = OS === 'darwin';
export const isWindows = OS === 'win32';
