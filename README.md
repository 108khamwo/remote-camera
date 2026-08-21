# Remote Camera PWA v0.11.8

- Dedicated data-only Message Channel (`msg_<camera stream>`) separate from video
- Control auto-connects to message publishers; telemetry/chat/ACK share the same bidirectional data channel
- Main Control message action sends to all cameras; selected-camera send remains secondary
- Sender action icons unified to a simpler line style
- Video, OBS, Smart Network, Fullscreen and Smooth Zoom retained
