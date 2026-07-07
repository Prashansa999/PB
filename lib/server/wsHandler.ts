import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import {
  getRoom,
  touchRoom,
  resetRoomForRetake,
  sweepExpiredRooms,
  type Room,
  type ConnectedPeer,
} from "./roomStore";
import {
  compositeRound,
  assembleFinalStrip,
  assembleClip,
  decodeCapturedFrame,
} from "./compositor";
import {
  COUNTDOWN_VISIBLE_MS,
  INTER_ROUND_DELAY_MS,
  CAPTION_MAX_LENGTH,
  type ClientMessage,
  type ServerMessage,
  type Role,
} from "../shared/protocol";
import { isFilterId } from "../shared/filters";
import { isPolaroidLayout } from "../shared/layout";

const DEFAULT_ROUND_TRIP_MS = 150;
const MAX_LEAD_MS = 8000;
const REVEAL_BUFFER_MS = 400;
// Debounces the *cheap* regenerate path (layout/caption) — see
// Room.stripRegradeTimer's comment in roomStore.ts.
const STRIP_REGRADE_DEBOUNCE_MS = 700;

function withVersion(url: string, version: number): string {
  return `${url}?v=${version}`;
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room: Room, message: ServerMessage): void {
  if (room.host) send(room.host.ws, message);
  if (room.guest) send(room.guest.ws, message);
}

function otherPeer(room: Room, role: Role): ConnectedPeer | null {
  return role === "host" ? room.guest : room.host;
}

function computeLeadMs(room: Room): number {
  const hostRt = room.host && room.host.roundTripMs >= 0 ? room.host.roundTripMs : DEFAULT_ROUND_TRIP_MS;
  const guestRt = room.guest && room.guest.roundTripMs >= 0 ? room.guest.roundTripMs : DEFAULT_ROUND_TRIP_MS;
  const safetyPad = Math.max(hostRt, guestRt) * 4 + 500;
  return Math.min(Math.max(COUNTDOWN_VISIBLE_MS, safetyPad), MAX_LEAD_MS);
}

function startRoundCountdown(room: Room, round: number): void {
  room.state = "countdown";
  room.currentRound = round;
  const leadMs = computeLeadMs(room);
  const tFire = Date.now() + leadMs;
  const tCountdownVisibleAt = tFire - COUNTDOWN_VISIBLE_MS;

  if (tCountdownVisibleAt - Date.now() > 300) {
    broadcast(room, { type: "stabilizing" });
  }

  broadcast(room, {
    type: "countdown-start",
    round,
    totalRounds: room.totalRounds,
    tFire,
    tCountdownVisibleAt,
  });
}

async function handleFrameComplete(room: Room, round: number): Promise<void> {
  const data = room.rounds[round];
  if (!data.hostFrame || !data.guestFrame) return; // waiting on the other side

  room.state = "compositing";
  broadcast(room, { type: "compositing" });

  const skewMs = Math.abs(
    (data.hostCapturedAtServer ?? 0) - (data.guestCapturedAtServer ?? 0)
  );

  try {
    const { buffer, url } = await compositeRound(
      room.code,
      round,
      data.hostFrame,
      data.guestFrame,
      room.selectedFilter
    );
    data.compositeBuffer = buffer;
    data.compositeUrl = url;

    broadcast(room, { type: "round-captured", round, compositeUrl: url, skewMs });
    // Core product-health metric (build-prompt §11): median/p95 capture
    // skew is what "at the same second" actually stands or falls on.
    console.log(`[room ${room.code}] round ${round} capture skew: ${skewMs}ms`);

    const nextRound = round + 1;
    if (nextRound < room.totalRounds) {
      room.state = "round-active";
      setTimeout(() => {
        // Guard: room may have been retaken/closed during the breather.
        if (getRoom(room.code) === room && room.currentRound === round) {
          startRoundCountdown(room, nextRound);
        }
      }, INTER_ROUND_DELAY_MS);
    } else {
      await finalizeStrip(room);
    }
  } catch (err) {
    broadcast(room, {
      type: "error",
      code: "composite-failed",
      message: "We couldn't process that round. Please try again.",
    });
    console.error(`[room ${room.code}] composite failed`, err);
  }
}

function roundBuffers(room: Room): Buffer[] {
  return room.rounds.map((r) => r.compositeBuffer).filter((b): b is Buffer => !!b);
}

/** First-time reveal at the end of round 4: assembles both the strip and
 * the clip, then broadcasts the synchronized reveal. */
async function finalizeStrip(room: Room): Promise<void> {
  const buffers = roundBuffers(room);
  const [{ url: stripUrl }, clip] = await Promise.all([
    assembleFinalStrip(room.code, buffers, room.caption, room.selectedLayout),
    assembleClip(room.code, buffers).catch((err) => {
      console.error(`[room ${room.code}] clip generation failed`, err);
      return null;
    }),
  ]);

  room.finalStripUrl = stripUrl;
  room.finalClipUrl = clip?.url ?? null;
  room.state = "revealed";
  room.revealVersion++;

  const tReveal = Date.now() + REVEAL_BUFFER_MS;
  broadcast(room, {
    type: "reveal",
    stripUrl: withVersion(stripUrl, room.revealVersion),
    clipUrl: room.finalClipUrl ? withVersion(room.finalClipUrl, room.revealVersion) : null,
    tReveal,
  });
}

/** Post-reveal filter change: the raw per-partner frames are still sitting
 * in room.rounds (never cleared), so this re-runs the *entire* pipeline —
 * filter -> composite -> strip -> clip — from those, without asking anyone
 * to pick up the camera again. */
async function regradeStrip(room: Room): Promise<void> {
  broadcast(room, { type: "regrading" });
  try {
    for (let round = 0; round < room.rounds.length; round++) {
      const data = room.rounds[round];
      if (!data.hostFrame || !data.guestFrame) continue;
      const { buffer, url } = await compositeRound(
        room.code,
        round,
        data.hostFrame,
        data.guestFrame,
        room.selectedFilter
      );
      data.compositeBuffer = buffer;
      data.compositeUrl = url;
    }
    await finalizeStrip(room);
  } catch (err) {
    broadcast(room, {
      type: "error",
      code: "regrade-failed",
      message: "We couldn't apply that filter. Please try again.",
    });
    console.error(`[room ${room.code}] regrade failed`, err);
  }
}

/** Post-reveal caption or layout change: cheaper than a filter regrade —
 * the round composites already reflect the current filter and don't need
 * touching, only the assembled strip (arrangement + caption text) gets
 * rebuilt. The clip never shows the caption or layout, so it's left
 * alone. */
async function regenerateStripOnly(room: Room): Promise<void> {
  try {
    const { url: stripUrl } = await assembleFinalStrip(
      room.code,
      roundBuffers(room),
      room.caption,
      room.selectedLayout
    );
    room.finalStripUrl = stripUrl;
    room.revealVersion++;
    broadcast(room, {
      type: "reveal",
      stripUrl: withVersion(stripUrl, room.revealVersion),
      clipUrl: room.finalClipUrl ? withVersion(room.finalClipUrl, room.revealVersion) : null,
      tReveal: Date.now(),
    });
  } catch (err) {
    console.error(`[room ${room.code}] caption regenerate failed`, err);
  }
}

/** Shared debounce for the cheap regenerate path — caption and layout
 * changes both go through this so a burst of either (or both) only
 * triggers one rebuild after things settle down. */
function scheduleCheapRegrade(room: Room): void {
  if (room.stripRegradeTimer) clearTimeout(room.stripRegradeTimer);
  room.stripRegradeTimer = setTimeout(() => {
    room.stripRegradeTimer = null;
    void regenerateStripOnly(room);
  }, STRIP_REGRADE_DEBOUNCE_MS);
}

interface SocketContext {
  code: string;
  role: Role;
}

const contexts = new WeakMap<WebSocket, SocketContext>();

export function attachWebSocketServer(server: HttpServer): void {
  // `noServer: true` + manual routing below is deliberate: `ws`'s built-in
  // `{ server, path }` mode attaches its own 'upgrade' listener that
  // *rejects with 400* any request whose path doesn't match — which would
  // also swallow Next's own dev-mode HMR WebSocket upgrade on the same
  // HTTP server. Handling 'upgrade' ourselves lets us ignore non-matching
  // paths instead of aborting them, so Next's listener still gets a turn.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "", "http://internal");
    if (pathname !== "/ws") return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://internal");
    const code = (url.searchParams.get("code") ?? "").toUpperCase();
    const requestedRole: Role = url.searchParams.get("role") === "host" ? "host" : "guest";

    const room = getRoom(code);
    if (!room) {
      send(ws, { type: "error", code: "room-not-found", message: "That room code doesn't exist or has expired." });
      ws.close();
      return;
    }

    if (room[requestedRole]) {
      send(ws, {
        type: "error",
        code: "role-taken",
        message: requestedRole === "host" ? "This room already has a host." : "Your partner already joined this room.",
      });
      ws.close();
      return;
    }

    const peer: ConnectedPeer = { ws, clockOffsetMs: 0, roundTripMs: -1 };
    room[requestedRole] = peer;
    touchRoom(room);
    contexts.set(ws, { code, role: requestedRole });

    send(ws, {
      type: "welcome",
      role: requestedRole,
      code,
      state: room.state,
      selectedFilter: room.selectedFilter,
      selectedLayout: room.selectedLayout,
      caption: room.caption,
    });

    if (room.host && room.guest) {
      if (room.state === "lobby") room.state = "ready";
      broadcast(room, { type: "peer-joined" });
    }

    ws.on("message", (raw) => {
      const ctx = contexts.get(ws);
      if (!ctx) return;
      const room = getRoom(ctx.code);
      if (!room) return;
      touchRoom(room);

      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const peer = room[ctx.role];
      const other = otherPeer(room, ctx.role);
      if (!peer) return;

      switch (message.type) {
        case "clock-sync-ping": {
          const now = Date.now();
          send(ws, { type: "clock-sync-pong", id: message.id, t0: message.t0, t1: now, t2: now });
          break;
        }

        case "sync-report": {
          peer.clockOffsetMs = message.offsetMs;
          peer.roundTripMs = message.roundTripMs;
          break;
        }

        case "signal": {
          if (other) send(other.ws, { type: "signal", payload: message.payload });
          break;
        }

        case "request-start-countdown": {
          if (room.state === "ready" && room.host && room.guest) {
            startRoundCountdown(room, 0);
          }
          break;
        }

        case "capture-frame": {
          if (room.state !== "countdown" && room.state !== "round-active") break;
          const roundData = room.rounds[message.round];
          if (!roundData) break;
          const buf = decodeCapturedFrame(message.dataUrl);
          const capturedAtServer = message.capturedAtLocal + peer.clockOffsetMs;
          if (ctx.role === "host") {
            roundData.hostFrame = buf;
            roundData.hostCapturedAtServer = capturedAtServer;
          } else {
            roundData.guestFrame = buf;
            roundData.guestCapturedAtServer = capturedAtServer;
          }
          void handleFrameComplete(room, message.round);
          break;
        }

        case "select-filter": {
          // Allowed before the countdown starts (the original "pick
          // together" moment) and again once the strip is revealed (a
          // do-over on the grade using the raw frames already on hand).
          // Disallowed mid-capture (countdown/round-active/compositing) —
          // changing the grade half-way through a strip would leave some
          // rounds on the old filter and some on the new one.
          if (!isFilterId(message.filterId)) break;
          if (room.state !== "lobby" && room.state !== "ready" && room.state !== "revealed") break;
          room.selectedFilter = message.filterId;
          broadcast(room, { type: "filter-selected", filterId: message.filterId });
          if (room.state === "revealed") void regradeStrip(room);
          break;
        }

        case "select-layout": {
          if (!isPolaroidLayout(message.layout)) break;
          if (room.state === "countdown" || room.state === "round-active" || room.state === "compositing") break;
          room.selectedLayout = message.layout;
          broadcast(room, { type: "layout-selected", layout: message.layout });
          // Cheap regenerate (like caption) — layout only re-arranges
          // already-composited round images, no filter reprocessing needed.
          if (room.state === "revealed") scheduleCheapRegrade(room);
          break;
        }

        case "set-caption": {
          if (typeof message.caption !== "string") break;
          if (room.state === "countdown" || room.state === "round-active" || room.state === "compositing") break;
          room.caption = message.caption.slice(0, CAPTION_MAX_LENGTH);
          broadcast(room, { type: "caption-updated", caption: room.caption });

          // Debounced: re-rendering the strip on every keystroke would
          // hammer sharp for no benefit — the live `caption-updated`
          // broadcast above already keeps both text inputs in sync
          // instantly, only the baked-in strip image lags slightly.
          if (room.state === "revealed") scheduleCheapRegrade(room);
          break;
        }

        case "retake": {
          resetRoomForRetake(room);
          broadcast(room, { type: "retake-ack" });
          break;
        }
      }
    });

    ws.on("close", () => {
      const ctx = contexts.get(ws);
      if (!ctx) return;
      const room = getRoom(ctx.code);
      if (!room) return;

      room[ctx.role] = null;
      touchRoom(room);

      const other = otherPeer(room, ctx.role);
      if (other) send(other.ws, { type: "peer-left" });

      if (room.state !== "revealed") {
        room.state = "lobby";
      }
    });
  });

  setInterval(sweepExpiredRooms, 60 * 1000).unref();
}
