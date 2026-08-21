# Remote Camera PWA v0.11.7

- Message Core restored from v0.11.2 (known-good baseline).
- Control primary message action now broadcasts to all cameras; Enter also sends to all.
- “Send only this camera” remains available as a secondary action.
- Fullscreen code is isolated in `fullscreen.js` so it does not modify the message core.
- Sender top icons use one consistent SVG line-icon set.
- Network-first service worker for active development.
