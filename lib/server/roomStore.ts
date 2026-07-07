import type { WebSocket } from "ws";
import { generateRoomCode } from "../shared/roomCode";
import { TOTAL_ROUNDS, type RoomState } from "../shared/protocol";

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
  room.state = "ready";
  room.currentRound = 0;
  room.rounds = freshRounds(room.totalRounds);
  room.finalStripUrl = null;
  room.finalClipUrl = null;
}

export function deleteRoom(code: string): void {
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
      rooms.delete(code);
    }
  }
}
