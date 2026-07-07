"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRoomSession, type RoundResult } from "@/lib/client/useRoomSession";
import type { Role } from "@/lib/shared/protocol";
import { PHOTOBOOTH_FILTERS, type FilterId } from "@/lib/shared/filters";
import type { PolaroidLayout } from "@/lib/shared/layout";
import { CountdownOverlay } from "./_components/CountdownOverlay";
import { FilterPicker } from "./_components/FilterPicker";
import { LayoutPicker } from "./_components/LayoutPicker";
import { CaptionField } from "./_components/CaptionField";
import { HeartBurst } from "./_components/HeartBurst";
import { PolaroidStrip } from "./_components/PolaroidStrip";

export function PhotoboothSession({ code, role }: { code: string; role: Role }) {
  const {
    state,
    localVideoRef,
    remoteVideoRef,
    startCountdown,
    retake,
    retryCamera,
    selectFilter,
    selectLayout,
    setCaption,
  } = useRoomSession(code, role);
  const [copied, setCopied] = useState(false);
  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const hasBurstThisSession = useRef(false);

  // Fire the heart burst once per capture session — the very first reveal,
  // not every subsequent filter/layout/caption regrade (that would get old
  // fast). Resets when a retake sends the phase back to "ready".
  useEffect(() => {
    if (state.phase === "revealed" && !hasBurstThisSession.current) {
      hasBurstThisSession.current = true;
      setShowHeartBurst(true);
    } else if (state.phase === "ready") {
      hasBurstThisSession.current = false;
    }
  }, [state.phase]);

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
              <>
                {showHeartBurst && <HeartBurst />}
                <StripReveal
                  stripUrl={state.stripUrl}
                  clipUrl={state.clipUrl}
                  roundResults={state.roundResults}
                  caption={state.caption}
                  regrading={state.regradingStrip}
                  selectedFilter={state.selectedFilter}
                  selectedLayout={state.selectedLayout}
                  onSelectFilter={selectFilter}
                  onSelectLayout={selectLayout}
                  onSetCaption={setCaption}
                  onRetake={retake}
                />
              </>
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
        style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
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
  roundResults,
  caption,
  regrading,
  selectedFilter,
  selectedLayout,
  onSelectFilter,
  onSelectLayout,
  onSetCaption,
  onRetake,
}: {
  stripUrl: string;
  clipUrl: string | null;
  roundResults: RoundResult[];
  caption: string;
  regrading: boolean;
  selectedFilter: FilterId;
  selectedLayout: PolaroidLayout;
  onSelectFilter: (id: FilterId) => void;
  onSelectLayout: (layout: PolaroidLayout) => void;
  onSetCaption: (caption: string) => void;
  onRetake: () => void;
}) {
  // Instant visual feedback the moment a filter tile is clicked — the CSS
  // approximation goes on the actual displayed photos right away, rather
  // than making people stare at the old grade for the second or so it
  // takes sharp to regrade all four rounds server-side. Clears itself once
  // a fresh stripUrl lands (the real, baked-in pixels have caught up) —
  // done as a render-time reset (React's recommended pattern for "some
  // state depends on a prop change") rather than an effect, since an
  // effect here would mean an extra, visibly-laggy render before the
  // preview clears.
  const [previewCss, setPreviewCss] = useState("none");
  const [lastStripUrl, setLastStripUrl] = useState(stripUrl);
  if (stripUrl !== lastStripUrl) {
    setLastStripUrl(stripUrl);
    setPreviewCss("none");
  }

  function handleSelectFilter(id: FilterId) {
    setPreviewCss(PHOTOBOOTH_FILTERS.find((f) => f.id === id)?.cssPreview ?? "none");
    onSelectFilter(id);
  }

  const previewPhotoUrl = [...roundResults].sort((a, b) => a.round - b.round)[0]?.compositeUrl ?? null;

  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <h1 className="mb-1 text-center text-2xl font-bold font-[family-name:var(--font-display)]">
        You did it — together. 🩷
      </h1>
      {regrading && (
        <p className="mb-2 animate-pulse text-xs font-medium text-accent-strong">Updating your strip…</p>
      )}

      <PolaroidStrip
        roundResults={roundResults}
        caption={caption}
        layout={selectedLayout}
        cssFilterPreview={previewCss}
      />

      <div className="mt-2 grid w-full grid-cols-2 gap-3">
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

      <div className="mt-5 w-full rounded-2xl border border-border bg-card p-4">
        <p className="text-center text-sm font-semibold text-accent-strong">Make it yours</p>
        <FilterPicker photoUrl={previewPhotoUrl} selectedFilter={selectedFilter} onSelect={handleSelectFilter} />
        <LayoutPicker selectedLayout={selectedLayout} onSelect={onSelectLayout} />
        <CaptionField caption={caption} onChange={onSetCaption} />
      </div>

      <button onClick={onRetake} className="mt-4 text-sm opacity-60 hover:opacity-100">
        Retake the strip
      </button>
    </div>
  );
}
