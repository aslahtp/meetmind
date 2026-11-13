// Types only. main.ts sets `app.isQuitting` so the window's close handler can tell "quit" from
// "hide to tray"; Electron's `App` doesn't declare it.
export {};

declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean;
    }
  }
}
