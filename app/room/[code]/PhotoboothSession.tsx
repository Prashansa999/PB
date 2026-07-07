"use client";

import { useState } from "react";
import Link from "next/link";
import { useRoomSession } from "@/lib/client/useRoomSession";
import type { Role, MagnetAddress } from "@/lib/shared/protocol";
import { CountdownOverlay } from "./_components/CountdownOverlay";
import { MagnetOrderForm } from "./_components/MagnetOrderForm";

export function PhotoboothSession({ code, role }: { code: string; role: Role }) {
  const { state, localVideoRef, remoteVideoRef, startCountdown, retake, retryCamera, orderMagnet } =
    useRoomSession(code, role);
  const [showMagnetForm, setShowMagnetForm] = useState(false);
  const [copied, setCopied] = useState(false);

  async function shareCode() {
    const url = `${window.location.origin}/room/${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Photobooth with me?", text: `Join my S P Photobooth room: ${code}`, url });
        return;
      } catch {
        // user cancelled the share sheet — fall through to clipboard copy
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleMagnetSubmit(addressHost: MagnetAddress, addressGuest: MagnetAddress) {
    orderMagnet(addressHost, addressGuest);
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/" className="text-sm font-semibold text-accent-strong">
          S P Photobooth
        </Link>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs opacity-60">
          Room {code}
        </span>
      </div>

      {state.phase === "checking-support" && <StatusCard title="Checking your browser…" />}

      {state.phase === "unsupported" && (
        <StatusCard title="This browser can't run S P Photobooth" body={state.unsupportedReason ?? undefined} />
      )}

      {state.phase === "requesting-camera" && (
        <StatusCard
          title="We need your camera"
          body="So your partner can see you — and so the strip has both of you in it. Look for your browser's permission prompt."
        />
      )}

      {state.phase === "camera-denied" && (
        <StatusCard title="Camera access was blocked">
          <p className="mt-2 text-sm opacity-75">
            Enable camera access for this site in your browser settings, then try again.
          </p>
          <button
            onClick={retryCamera}
            className="mt-4 rounded-full bg-accent px-6 py-2 font-medium text-white"
          >
            Try again
          </button>
        </StatusCard>
      )}

      {state.phase === "connecting" && <StatusCard title="Connecting…" />}

      {state.phase !== "checking-support" &&
        state.phase !== "unsupported" &&
        state.phase !== "requesting-camera" &&
        state.phase !== "camera-denied" &&
        state.phase !== "connecting" && (
          <>
            {state.phase === "lobby-waiting" && (
              <LobbyWaiting role={role} code={code} onShare={shareCode} copied={copied} />
            )}

            {state.phase !== "lobby-waiting" && state.phase !== "revealed" && (
              <div className="w-full max-w-2xl">
                <RoundIndicator current={state.currentRound} total={state.totalRounds} phase={state.phase} />

                <div className="relative mt-4 grid grid-cols-2 gap-3 overflow-hidden rounded-3xl border-8 border-card bg-black p-2 shadow-2xl">
                  <VideoTile videoRef={localVideoRef} label="You" mirrored muted />
                  <VideoTile videoRef={remoteVideoRef} label="Them" mirrored={false} muted={false} />

                  {state.flashing && (
                    <div className="flash-overlay pointer-events-none absolute inset-0 bg-white" />
                  )}

                  {(state.phase === "countdown" || state.phase === "stabilizing") &&
                    state.countdownTFire !== null &&
                    state.countdownVisibleAt !== null && (
                      <CountdownOverlay
                        tFire={state.countdownTFire}
                        tCountdownVisibleAt={state.countdownVisibleAt}
                      />
                    )}

                  {state.phase === "compositing" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <p className="animate-pulse rounded-full bg-white/90 px-6 py-3 font-medium text-accent-strong">
                        Developing your strip…
                      </p>
                    </div>
                  )}
                </div>

                {state.phase === "ready" && (
                  <div className="mt-6 flex justify-center">
                    <button
                      onClick={startCountdown}
                      className="rounded-full bg-accent px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110"
                    >
                      Start countdown
                    </button>
                  </div>
                )}

                {state.phase === "round-breather" && (
                  <p className="mt-6 text-center text-sm opacity-70">
                    Got it! Get ready for the next one…
                  </p>
                )}
              </div>
            )}

            {state.phase === "revealed" && state.stripUrl && (
              <StripReveal
                stripUrl={state.stripUrl}
                clipUrl={state.clipUrl}
                onRetake={retake}
                onOrderMagnet={() => setShowMagnetForm(true)}
              />
            )}
          </>
        )}

      {state.phase === "disconnected" && (
        <StatusCard title="Connection lost" body={state.errorMessage ?? "We lost the connection to this room."}>
          <Link href="/" className="mt-4 inline-block rounded-full bg-accent px-6 py-2 font-medium text-white">
            Start a new session
          </Link>
        </StatusCard>
      )}

      {showMagnetForm && (
        <MagnetOrderForm
          confirmedOrderId={state.magnetOrderId}
          onSubmit={handleMagnetSubmit}
          onClose={() => setShowMagnetForm(false)}
        />
      )}
    </div>
  );
}

function StatusCard({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {body && <p className="mt-2 text-sm opacity-75">{body}</p>}
      {children}
    </div>
  );
}

function LobbyWaiting({
  role,
  code,
  onShare,
  copied,
}: {
  role: Role;
  code: string;
  onShare: () => void;
  copied: boolean;
}) {
  if (role === "guest") {
    return <StatusCard title="Joining the room…" body="Getting you connected to your partner." />;
  }
  return (
    <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
      <h1 className="text-lg font-semibold">Send this code to your partner</h1>
      <p className="mt-4 font-mono text-5xl font-bold tracking-[0.3em] text-accent-strong">{code}</p>
      <button
        onClick={onShare}
        className="mt-6 rounded-full bg-accent px-6 py-3 font-medium text-white transition hover:brightness-110"
      >
        {copied ? "Link copied!" : "Send code"}
      </button>
      <p className="mt-6 flex items-center justify-center gap-2 text-sm opacity-60">
        <span className="h-2 w-2 animate-pulse rounded-full bg-sync" />
        Waiting for them to join…
      </p>
    </div>
  );
}

function VideoTile({
  videoRef,
  label,
  mirrored,
  muted,
}: {
  videoRef: (node: HTMLVideoElement | null) => void;
  label: string;
  mirrored: boolean;
  muted: boolean;
}) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-zinc-900">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full object-cover"
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      />
      <span className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
        {label}
      </span>
    </div>
  );
}

function RoundIndicator({
  current,
  total,
  phase,
}: {
  current: number;
  total: number;
  phase: string;
}) {
  const label =
    phase === "ready"
      ? `Ready for photo ${current + 1} of ${total}`
      : phase === "stabilizing" || phase === "countdown"
      ? `Photo ${current + 1} of ${total}`
      : `Photo ${current + 1} of ${total} captured`;
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-2 w-8 rounded-full ${i <= current && phase !== "ready" ? "bg-accent" : i < current ? "bg-accent" : "bg-border"}`}
        />
      ))}
      <span className="ml-2 text-xs opacity-60">{label}</span>
    </div>
  );
}

function StripReveal({
  stripUrl,
  clipUrl,
  onRetake,
  onOrderMagnet,
}: {
  stripUrl: string;
  clipUrl: string | null;
  onRetake: () => void;
  onOrderMagnet: () => void;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <h1 className="mb-4 text-center text-2xl font-bold font-[family-name:var(--font-display)]">
        You did it — together.
      </h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- server-generated, non-static asset; next/image's optimizer adds no value here */}
      <img
        src={stripUrl}
        alt="Your photobooth strip"
        className="strip-reveal w-full max-w-xs rounded-lg shadow-2xl"
      />
      <div className="mt-6 grid w-full grid-cols-2 gap-3">
        <a
          href={stripUrl}
          download="sp-photobooth-strip.png"
          className="rounded-full border border-border py-3 text-center text-sm font-medium hover:border-accent hover:text-accent"
        >
          Download PNG
        </a>
        {clipUrl && (
          <a
            href={clipUrl}
            download="sp-photobooth-clip.gif"
            className="rounded-full border border-border py-3 text-center text-sm font-medium hover:border-accent hover:text-accent"
          >
            Download clip
          </a>
        )}
      </div>
      <button
        onClick={onOrderMagnet}
        className="mt-3 w-full rounded-full bg-accent py-3 font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110"
      >
        Turn this into a magnet 🧲
      </button>
      <button onClick={onRetake} className="mt-3 text-sm opacity-60 hover:opacity-100">
        Retake the strip
      </button>
    </div>
  );
}
