# S P Photobooth

A realtime, synchronized online photobooth for two people in different places — get a
room code, share it, and a server-scheduled countdown fires the shot on both screens
at the same instant. Built from [this spec](https://getangie.com/photobooth)-inspired
build prompt, focused entirely on making the synchronized capture actually work.

## How it works

- **Landing page** (`/`) — start a session (creates a room + 5-character code) or join
  one with a code someone sent you.
- **Room** (`/room/[code]`) — camera permission, a live WebRTC preview of both people,
  a synchronized 3-2-1 countdown, 4 rounds of capture, server-side compositing into a
  classic photo strip, and a simultaneous reveal.
- Download the strip as a PNG or an animated GIF "clip," retake, or run a (mock) magnet
  order flow that collects both partners' shipping addresses.

### The synchronization mechanism

This is the part the whole feature lives or dies on. See `lib/client/clockSync.ts` and
`lib/server/wsHandler.ts`:

1. Each client measures its clock offset from the server via a handful of WebSocket
   ping/pong round trips (NTP-style), and reports the result back to the server.
2. When a countdown starts, the server picks an **absolute future server timestamp**
   (`tFire`) — not a "count down from N seconds" duration — and broadcasts it to both
   clients along with the measured offsets.
3. Each client converts `tFire` into its own local schedule and fires the capture via
   `requestAnimationFrame` polling in the final stretch (`lib/client/scheduler.ts`),
   not a plain `setTimeout`, which drifts under background-tab throttling.
4. The server logs the actual achieved skew between both captures on every round —
   watch the server console for `capture skew: Nms`.

On localhost this measures well under 5ms; the design target for real-world networks
is a median under 100ms (see the original build prompt for the full rationale).

## Running it

```bash
npm install
npm run dev     # dev server with HMR, on http://localhost:3000
npm run build   # production build
npm start       # production server
```

There's no database and no external services required — everything runs from a single
Node process. Captured frames and generated strips are written to `storage/strips/`
(gitignored) and served back through `/api/strip-image/[...path]`.

### Try it with two tabs

Open two browser tabs/windows (or two devices) to `http://localhost:3000`. Start a
session in one, copy the room URL, and open it in the other. Camera permission is
required in both.

## What's real vs. mocked

- Room/session management, WebRTC signaling, clock sync, the countdown scheduler,
  capture, server-side compositing (PNG strip + animated GIF clip), and the reveal are
  all fully implemented and working end to end.
- The magnet order flow is a **demo checkout**: it collects both shipping addresses and
  "confirms" an order, but there's no real payment processor or print-vendor
  integration wired up (see the comment in `lib/server/wsHandler.ts`).

## Project layout

```
server.ts                        Custom Node server: Next.js + the WebSocket layer
lib/shared/                       Types and constants shared by client and server
lib/server/                       Room store, WS message handling, image compositing
lib/client/                       Clock sync, precise scheduling, the room session hook
app/page.tsx                      Landing page
app/room/[code]/                  The live session UI
app/api/strip-image/[...path]/    Serves generated strips/clips from disk
```
