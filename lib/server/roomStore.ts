import type { WebSocket } from "ws";
import { generateRoomCode } from "../shared/roomCode";
import { TOTAL_ROUNDS, type RoomState } from "../shared/protocol";
import type { FilterId } from "../shared/filters";
import type { PolaroidLayout } from "../shared/layout";

export interface ConnectedPeer {
  ws: WebSocket;
  clockOffsetMs: number;
  // -1 means "not measured yet"; scheduling code falls back to a
  // conservative default padding until a real sample arrives.
  roundTripMs: number;
}

export interface RoundData {
  hostFrame: Buffer | null;
  guestFrame: Buffer | null;
  hostCapturedAtServer: number | null;
  guestCapturedAtServer: number | null;
  compositeUrl: string | null;
  compositeBuffer: Buffer | null;
}

export interface Room {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  state: RoomState;
  currentRound: number;
  totalRounds: number;
  host: ConnectedPeer | null;
  guest: ConnectedPeer | null;
  rounds: RoundData[];
  finalStripUrl: string | null;
  finalClipUrl: string | null;
  // A shared, synced choice (see wsHandler's "select-filter" handling) —
  // deliberately not a per-client preference, so both partners' strips
  // always match.
  selectedFilter: FilterId;
  // Also shared/synced — how the round photos are arranged into the final
  // strip image. Same persistence rules as selectedFilter.
  selectedLayout: PolaroidLayout;
  // Also shared/synced — soft-focus "portrait" background blur baked into
  // each round tile. Changing it needs the full per-round regrade (like a
  // filter change), not the cheap strip-only path.
  backgroundBlur: boolean;
  // Also shared/synced — a short note either partner can write, baked into
  // the strip. Not cleared on retake, same reasoning as selectedFilter.
  caption: string;
  // Bumped every time the strip/clip files on disk are regenerated in
  // place (filter, layout, or caption change after reveal). The filename
  // never changes, so this gets appended as a `?v=` query param —
  // otherwise the browser would keep showing a cached copy of the old one.
  revealVersion: number;
  // Debounces the *cheap* regenerate path (layout/caption changes, which
  // only re-arrange already-composited round images) so rapid edits don't
  // hammer sharp on every keystroke/click. Filter changes are expensive
  // (re-run the whole per-round pipeline) and always run immediately
  // instead of through this timer.
  stripRegradeTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();

function freshRounds(count: number): RoundData[] {
  return Array.from({ length: count }, () => ({
    hostFrame: null,
    guestFrame: null,
    hostCapturedAtServer: null,
    guestCapturedAtServer: null,
    compositeUrl: null,
    compositeBuffer: null,
  }));
}

export function createRoom(): Room {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const room: Room = {
    code,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    state: "lobby",
    currentRound: 0,
    totalRounds: TOTAL_ROUNDS,
    host: null,
    guest: null,
    rounds: freshRounds(TOTAL_ROUNDS),
    finalStripUrl: null,
    finalClipUrl: null,
    selectedFilter: "film",
    selectedLayout: "strip",
    // On by default — the soft-focus background is part of the dreamy
    // house look now; the reveal panel's toggle still turns it off.
    backgroundBlur: true,
    caption: "",
    revealVersion: 0,
    stripRegradeTimer: null,
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function touchRoom(room: Room): void {
  room.lastActivityAt = Date.now();
}

export function resetRoomForRetake(room: Room): void {
  if (room.stripRegradeTimer) clearTimeout(room.stripRegradeTimer);
  room.stripRegradeTimer = null;
  room.state = "ready";
  room.currentRound = 0;
  room.rounds = freshRounds(room.totalRounds);
  room.finalStripUrl = null;
  room.finalClipUrl = null;
}

export function deleteRoom(code: string): void {
  const room = rooms.get(code);
  if (room?.stripRegradeTimer) clearTimeout(room.stripRegradeTimer);
  rooms.delete(code);
}

const LOBBY_TIMEOUT_MS = 30 * 60 * 1000; // 30 min: room never left the lobby
const COMPLETED_TIMEOUT_MS = 72 * 60 * 60 * 1000; // 72h: strip stays downloadable

export function sweepExpiredRooms(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idleMs = now - room.lastActivityAt;
    const bothGone = !room.host && !room.guest;
    const isDone = room.state === "revealed";
    if (
      (bothGone && idleMs > 5 * 60 * 1000) ||
      (!isDone && idleMs > LOBBY_TIMEOUT_MS) ||
      (isDone && idleMs > COMPLETED_TIMEOUT_MS)
    ) {
      deleteRoom(code);
    }
  }
}
