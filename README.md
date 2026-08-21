# Remote Camera PWA v0.11.9

- Message Core restored from v0.11.2 (known-good baseline).
- Control primary message action now broadcasts to all cameras; Enter also sends to all.
- “Send only this camera” remains available as a secondary action.
- Fullscreen code is isolated in `fullscreen.js` so it does not modify the message core.
- Sender top icons use one consistent SVG line-icon set.
- Network-first service worker for active development.


## v0.11.9
- Rebuilt messaging as one Control data publisher with every Sender explicitly viewing it.
- Camera presence/telemetry now arrives over the same deterministic data channel.
- Video/OBS stays independent.
- Send All remains the primary action; selected-camera messages are filtered by targetStream.
