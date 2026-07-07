"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ClockSync } from "./clockSync";
import { scheduleAtPreciseTime } from "./scheduler";
import type { ClientMessage, Role, ServerMessage } from "../shared/protocol";
import { TOTAL_ROUNDS } from "../shared/protocol";
import type { FilterId } from "../shared/filters";
import type { PolaroidLayout } from "../shared/layout";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const CLOCK_RESYNC_INTERVAL_MS = 15_000;

export type Phase =
  | "checking-support"
  | "unsupported"
  | "requesting-camera"
  | "camera-denied"
  | "connecting"
  | "lobby-waiting"
  | "ready"
  | "stabilizing"
  | "countdown"
  | "round-breather"
  | "compositing"
  | "revealed"
  | "disconnected";

export interface RoundResult {
  round: number;
  compositeUrl: string;
  skewMs: number;
}

export interface RoomSessionState {
  phase: Phase;
  role: Role | null;
  peerConnected: boolean;
  currentRound: number;
  totalRounds: number;
  countdownTFire: number | null;
  countdownVisibleAt: number | null;
  flashing: boolean;
  roundResults: RoundResult[];
  stripUrl: string | null;
  clipUrl: string | null;
  errorMessage: string | null;
  unsupportedReason: string | null;
  selectedFilter: FilterId;
  selectedLayout: PolaroidLayout;
  backgroundBlur: boolean;
  caption: string;
  regradingStrip: boolean;
}

type Action =
  | { type: "SUPPORT_OK" }
  | { type: "SUPPORT_FAIL"; reason: string }
  | { type: "CAMERA_REQUESTING" }
  | { type: "CAMERA_DENIED" }
  | { type: "WS_CONNECTING" }
  | { type: "WS_DISCONNECTED" }
  | { type: "FLASH_ON" }
  | { type: "FLASH_OFF" }
  | { type: "SERVER"; message: ServerMessage };

const initialState: RoomSessionState = {
  phase: "checking-support",
  role: null,
  peerConnected: false,
  currentRound: 0,
  totalRounds: TOTAL_ROUNDS,
  countdownTFire: null,
  countdownVisibleAt: null,
  flashing: false,
  roundResults: [],
  stripUrl: null,
  clipUrl: null,
  errorMessage: null,
  unsupportedReason: null,
  selectedFilter: "film",
  selectedLayout: "strip",
  backgroundBlur: false,
  caption: "",
  regradingStrip: false,
};

function reducer(state: RoomSessionState, action: Action): RoomSessionState {
  switch (action.type) {
    case "SUPPORT_OK":
      return { ...state, phase: "requesting-camera" };
    case "SUPPORT_FAIL":
      return { ...state, phase: "unsupported", unsupportedReason: action.reason };
    case "CAMERA_REQUESTING":
      return { ...state, phase: "requesting-camera" };
    case "CAMERA_DENIED":
      return { ...state, phase: "camera-denied" };
    case "WS_CONNECTING":
      return { ...state, phase: "connecting" };
    case "WS_DISCONNECTED":
      return { ...state, phase: "disconnected", peerConnected: false };
    case "FLASH_ON":
      return { ...state, flashing: true };
    case "FLASH_OFF":
      return { ...state, flashing: false };
    case "SERVER": {
      const msg = action.message;
      switch (msg.type) {
        case "welcome":
          return {
            ...state,
            role: msg.role,
            phase: "lobby-waiting",
            selectedFilter: msg.selectedFilter,
            selectedLayout: msg.selectedLayout,
            backgroundBlur: msg.backgroundBlur,
            caption: msg.caption,
          };
        case "peer-joined":
          return { ...state, peerConnected: true, phase: "ready" };
        case "peer-left":
          return { ...state, peerConnected: false, phase: "lobby-waiting" };
        case "filter-selected":
          return { ...state, selectedFilter: msg.filterId };
        case "layout-selected":
          return { ...state, selectedLayout: msg.layout };
        case "background-blur-changed":
          return { ...state, backgroundBlur: msg.enabled };
        case "caption-updated":
          return { ...state, caption: msg.caption };
        case "regrading":
          return { ...state, regradingStrip: true };
        case "stabilizing":
          return { ...state, phase: "stabilizing" };
        case "countdown-start":
          return {
            ...state,
            phase: "countdown",
            currentRound: msg.round,
            totalRounds: msg.totalRounds,
            countdownTFire: msg.tFire,
            countdownVisibleAt: msg.tCountdownVisibleAt,
          };
        case "round-captured": {
          // After the *last* round there is no "next one" — jumping to the
          // round-breather prep ("get ready…") makes it look like a 5th
          // photo is coming before the reveal lands. Go straight to the
          // developing/compositing state instead so the count ends cleanly
          // at exactly totalRounds.
          const isLastRound = msg.round >= state.totalRounds - 1;
          return {
            ...state,
            phase: isLastRound ? "compositing" : "round-breather",
            roundResults: [
              ...state.roundResults.filter((r) => r.round !== msg.round),
              { round: msg.round, compositeUrl: msg.compositeUrl, skewMs: msg.skewMs },
            ],
          };
        }
        case "compositing":
          return { ...state, phase: "compositing" };
        case "reveal":
          return {
            ...state,
            phase: "revealed",
            stripUrl: msg.stripUrl,
            clipUrl: msg.clipUrl,
            regradingStrip: false,
          };
        case "retake-ack":
          return {
            ...initialState,
            phase: "ready",
            role: state.role,
            peerConnected: state.peerConnected,
            // The server keeps the chosen filter, layout and caption across
            // a retake (see resetRoomForRetake) — mirror that here instead
            // of dropping back to defaults, or the pickers would silently
            // lie about what the next strip will actually use.
            selectedFilter: state.selectedFilter,
            selectedLayout: state.selectedLayout,
            backgroundBlur: state.backgroundBlur,
            caption: state.caption,
          };
        case "error":
          return { ...state, errorMessage: msg.message };
        case "room-expired":
          return { ...state, phase: "disconnected", errorMessage: "This room has expired." };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

export function useRoomSession(code: string, role: Role) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const clockSyncRef = useRef<ClockSync | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const cancelScheduleRef = useRef<(() => void) | null>(null);
  const makingOfferRef = useRef(false);

  // The <video> tiles only mount once the UI leaves the loading phases
  // (camera permission / connecting), which happens *after* the camera
  // stream and any WebRTC remote stream are already obtained. A plain
  // `ref.current = stream` assignment made before that point would target
  // a not-yet-mounted node and silently do nothing. These callback refs
  // fire on actual mount, so they (re)attach whichever stream is already
  // sitting in the ref at that moment.
  const attachLocalVideo = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    if (node && localStreamRef.current) node.srcObject = localStreamRef.current;
  }, []);
  const attachRemoteVideo = useCallback((node: HTMLVideoElement | null) => {
    remoteVideoRef.current = node;
    if (node && remoteStreamRef.current) node.srcObject = remoteStreamRef.current;
  }, []);

  const sendMessage = useCallback((message: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const captureFrame = useCallback(
    (round: number) => {
      const video = localVideoRef.current;
      if (!video || video.readyState < 2) return;

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Mirror the frame so the download matches what the user saw of
      // themselves in the mirrored preview.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      dispatch({ type: "FLASH_ON" });
      setTimeout(() => dispatch({ type: "FLASH_OFF" }), 180);

      sendMessage({
        type: "capture-frame",
        round,
        dataUrl,
        capturedAtLocal: Date.now(),
      });
    },
    [sendMessage]
  );

  // ---- WebRTC plumbing -----------------------------------------------
  const ensurePeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage({ type: "signal", payload: { candidate: event.candidate.toJSON() } });
      }
    };

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onnegotiationneeded = async () => {
      // Host is the designated offerer to avoid "glare" (both sides
      // simultaneously creating offers).
      if (role !== "host") return;
      try {
        makingOfferRef.current = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendMessage({ type: "signal", payload: { sdp: pc.localDescription } });
      } finally {
        makingOfferRef.current = false;
      }
    };

    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
    }

    pcRef.current = pc;
    return pc;
  }, [role, sendMessage]);

  const handleSignal = useCallback(
    async (payload: unknown) => {
      const pc = ensurePeerConnection();
      const data = payload as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

      if (data.sdp) {
        const collision = data.sdp.type === "offer" && (makingOfferRef.current || pc.signalingState !== "stable");
        // Guest always yields to the host's offer; this only matters if
        // both ends raced, which the host-is-offerer rule mostly prevents.
        if (collision && role === "host") return;

        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendMessage({ type: "signal", payload: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          console.warn("Failed to add ICE candidate", err);
        }
      }
    },
    [ensurePeerConnection, role, sendMessage]
  );

  // ---- Feature-support check ------------------------------------------
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.RTCPeerConnection ||
      !window.WebSocket
    ) {
      dispatch({
        type: "SUPPORT_FAIL",
        reason: "This browser is missing camera or realtime video support. Try the latest Chrome or Safari.",
      });
      return;
    }
    dispatch({ type: "SUPPORT_OK" });
  }, []);

  // `cameraReady` (not `state.phase`) is what gates the WebSocket effect
  // below. `state.phase` keeps changing for the rest of the session
  // (lobby-waiting -> ready -> countdown -> ...), and effects re-run their
  // cleanup whenever a dependency changes — if the WS effect depended on
  // `state.phase` directly, every later phase transition would tear down
  // and never reopen the *live* socket. This flips exactly once.
  const [cameraReady, setCameraReady] = useState(false);

  // ---- Camera permission + local preview ------------------------------
  useEffect(() => {
    if (state.phase !== "requesting-camera") return;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        dispatch({ type: "WS_CONNECTING" });
        setCameraReady(true);
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "CAMERA_DENIED" });
      });

    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  // ---- WebSocket lifecycle --------------------------------------------
  useEffect(() => {
    if (!cameraReady) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws?code=${code}&role=${role}`);
    wsRef.current = ws;

    const clockSync = new ClockSync((id, t0) => {
      ws.send(JSON.stringify({ type: "clock-sync-ping", id, t0 } satisfies ClientMessage));
    });
    clockSyncRef.current = clockSync;

    const runSync = () => {
      clockSync.measure().then(({ offsetMs, roundTripMs }) => {
        sendMessage({ type: "sync-report", offsetMs, roundTripMs });
      });
    };

    ws.addEventListener("open", () => {
      runSync();
    });

    const resyncTimer = setInterval(runSync, CLOCK_RESYNC_INTERVAL_MS);

    ws.addEventListener("message", (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "clock-sync-pong") {
        clockSync.handlePong(message.id, message.t0, message.t1, message.t2);
        return;
      }
      if (message.type === "signal") {
        void handleSignal(message.payload);
        return;
      }
      dispatch({ type: "SERVER", message });
    });

    ws.addEventListener("close", () => {
      dispatch({ type: "WS_DISCONNECTED" });
    });

    ws.addEventListener("error", () => {
      dispatch({ type: "WS_DISCONNECTED" });
    });

    return () => {
      clearInterval(resyncTimer);
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, code, role]);

  // Kick off the peer connection once we know both sides are present.
  useEffect(() => {
    if (state.peerConnected) ensurePeerConnection();
  }, [state.peerConnected, ensurePeerConnection]);

  // ---- Countdown scheduling -------------------------------------------
  useEffect(() => {
    if (state.phase !== "countdown" || state.countdownTFire === null) return;

    const cancel = scheduleAtPreciseTime(state.countdownTFire, () => {
      captureFrame(state.currentRound);
    });
    cancelScheduleRef.current = cancel;
    return cancel;
  }, [state.phase, state.countdownTFire, state.currentRound, captureFrame]);

  // ---- Cleanup on unmount ----------------------------------------------
  useEffect(() => {
    return () => {
      cancelScheduleRef.current?.();
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startCountdown = useCallback(() => {
    sendMessage({ type: "request-start-countdown" });
  }, [sendMessage]);

  const retake = useCallback(() => {
    sendMessage({ type: "retake" });
  }, [sendMessage]);

  const retryCamera = useCallback(() => {
    dispatch({ type: "CAMERA_REQUESTING" });
  }, []);

  const selectFilter = useCallback(
    (filterId: FilterId) => {
      sendMessage({ type: "select-filter", filterId });
    },
    [sendMessage]
  );

  const selectLayout = useCallback(
    (layout: PolaroidLayout) => {
      sendMessage({ type: "select-layout", layout });
    },
    [sendMessage]
  );

  const setBackgroundBlur = useCallback(
    (enabled: boolean) => {
      sendMessage({ type: "set-background-blur", enabled });
    },
    [sendMessage]
  );

  const setCaption = useCallback(
    (caption: string) => {
      sendMessage({ type: "set-caption", caption });
    },
    [sendMessage]
  );

  return {
    state,
    localVideoRef: attachLocalVideo,
    remoteVideoRef: attachRemoteVideo,
    startCountdown,
    retake,
    retryCamera,
    selectFilter,
    selectLayout,
    setBackgroundBlur,
    setCaption,
  };
}
