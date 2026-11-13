// Types shared by the main process and the renderer. Types only: never put runtime code in this folder.
// The renderer must import with `import type` (it is bundled by Vite and must not pull in electron/).

export type * from './calendar';
export type * from './config';
export type * from './ipc';
export type * from './overlay';
export type * from './providers';
export type * from './session';
export type * from './updater';
