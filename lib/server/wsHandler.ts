import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { randomUUID } from "crypto";
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
  type ClientMessage,
  type ServerMessage,
  type Role,
} from "../shared/protocol";

const DEFAULT_ROUND_TRIP_MS = 150;
const MAX_LEAD_MS = 8000;
const REVEAL_BUFFER_MS = 400;

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
    const { buffer, url } = await compositeRound(room.code, round, data.hostFrame, data.guestFrame);
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

async function finalizeStrip(room: Room): Promise<void> {
  const buffers = room.rounds.map((r) => r.compositeBuffer).filter((b): b is Buffer => !!b);
  const [{ url: stripUrl }, clip] = await Promise.all([
    assembleFinalStrip(room.code, buffers),
    assembleClip(room.code, buffers).catch((err) => {
      console.error(`[room ${room.code}] clip generation failed`, err);
      return null;
    }),
  ]);

  room.finalStripUrl = stripUrl;
  room.finalClipUrl = clip?.url ?? null;
  room.state = "revealed";

  const tReveal = Date.now() + REVEAL_BUFFER_MS;
  broadcast(room, {
    type: "reveal",
    stripUrl,
    clipUrl: room.finalClipUrl,
    tReveal,
  });
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

    send(ws, { type: "welcome", role: requestedRole, code, state: room.state });

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

        case "retake": {
          resetRoomForRetake(room);
          broadcast(room, { type: "retake-ack" });
          break;
        }

        case "order-magnet": {
          // Demo/mock fulfillment: no real payment or print-vendor call is
          // wired up. A production build would create a Stripe PaymentIntent
          // and submit `message.addressHost` / `message.addressGuest` plus
          // the final strip asset to a print-on-demand order API here.
          const orderId = randomUUID().slice(0, 8).toUpperCase();
          broadcast(room, { type: "magnet-order-confirmed", orderId });
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
