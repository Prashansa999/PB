// Shared WebSocket message contract between the browser client and the
// custom Node server (server.ts). Keeping this in one file means both
// sides fail to compile if a message shape drifts out of sync.

import type { FilterId } from "./filters";
import type { PolaroidLayout } from "./layout";

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
  | { type: "select-layout"; layout: PolaroidLayout }
  | { type: "set-caption"; caption: string };

export const CAPTION_MAX_LENGTH = 80;

// ---------- Server -> Client ----------

export type ServerMessage =
  | {
      type: "welcome";
      role: Role;
      code: string;
      state: RoomState;
      selectedFilter: FilterId;
      selectedLayout: PolaroidLayout;
      caption: string;
    }
  | { type: "peer-joined" }
  | { type: "peer-left" }
  | { type: "filter-selected"; filterId: FilterId }
  | { type: "layout-selected"; layout: PolaroidLayout }
  | { type: "caption-updated"; caption: string }
  // Distinct from "compositing": that phase covers the initial capture
  // flow. This one fires when an already-revealed strip is being
  // re-rendered (new filter or caption) — the UI stays on the reveal
  // screen and just shows a lightweight "updating..." state over it.
  | { type: "regrading" }
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
  | { type: "error"; code: string; message: string }
  | { type: "room-expired" };
