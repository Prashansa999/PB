// Shared WebSocket message contract between the browser client and the
// custom Node server (server.ts). Keeping this in one file means both
// sides fail to compile if a message shape drifts out of sync.

import type { FilterId } from "./filters";

export type Role = "host" | "guest";

export type RoomState =
  | "lobby"
  | "ready"
  | "countdown"
  | "round-active"
  | "compositing"
  | "revealed";

export const TOTAL_ROUNDS = 4;
// Fixed portion of every countdown: the visible 3-2-1 beats, one per second,
// landing exactly on tFire.
export const COUNTDOWN_VISIBLE_MS = 3200;
// Breather between rounds so partners can reset their pose.
export const INTER_ROUND_DELAY_MS = 2600;

// ---------- Client -> Server ----------

export type ClientMessage =
  | { type: "clock-sync-ping"; id: string; t0: number }
  | { type: "sync-report"; offsetMs: number; roundTripMs: number }
  | { type: "signal"; payload: unknown }
  | { type: "request-start-countdown" }
  | {
      type: "capture-frame";
      round: number;
      dataUrl: string;
      capturedAtLocal: number;
    }
  | { type: "retake" }
  | { type: "select-filter"; filterId: FilterId }
  | { type: "order-magnet"; addressHost: MagnetAddress; addressGuest: MagnetAddress };

export interface MagnetAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

// ---------- Server -> Client ----------

export type ServerMessage =
  | { type: "welcome"; role: Role; code: string; state: RoomState; selectedFilter: FilterId }
  | { type: "peer-joined" }
  | { type: "peer-left" }
  | { type: "filter-selected"; filterId: FilterId }
  | { type: "clock-sync-pong"; id: string; t0: number; t1: number; t2: number }
  | { type: "signal"; payload: unknown }
  | {
      type: "countdown-start";
      round: number;
      totalRounds: number;
      tFire: number;
      tCountdownVisibleAt: number;
    }
  | { type: "stabilizing" }
  | {
      type: "round-captured";
      round: number;
      compositeUrl: string;
      skewMs: number;
    }
  | { type: "compositing" }
  | { type: "reveal"; stripUrl: string; clipUrl: string | null; tReveal: number }
  | { type: "retake-ack" }
  | { type: "magnet-order-confirmed"; orderId: string }
  | { type: "error"; code: string; message: string }
  | { type: "room-expired" };
