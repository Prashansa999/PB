"use client";

import type { RoundResult } from "@/lib/client/useRoomSession";
import type { PolaroidLayout } from "@/lib/shared/layout";

const STRIP_TILTS_DEG = [-4, 3, -3.5, 4.5];
const STRIP_DRIFTS_PX = [-10, 8, -6, 10];
const COLLAGE_TILTS_DEG = [-5, 4, -4, 5];
const STACK_TILTS_DEG = [-9, 6, -7, 10];
const STACK_FAN_PX: { dx: number; dy: number }[] = [
  { dx: -26, dy: 0 },
  { dx: 12, dy: 10 },
  { dx: -10, dy: 22 },
  { dx: 24, dy: 30 },
];

function Card({
  round,
  compositeUrl,
  caption,
  isLast,
  cssFilterPreview,
  style,
}: {
  round: number;
  compositeUrl: string;
  caption: string;
  isLast: boolean;
  cssFilterPreview: string;
  style: React.CSSProperties;
}) {
  return (
    <div
      className="polaroid-card rounded-md bg-white p-3 pb-6 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.35)]"
      style={style}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- server-generated, non-static asset */}
      <img
        src={compositeUrl}
        alt={`Photo ${round + 1}`}
        className="w-64 rounded-sm sm:w-72"
        style={{ filter: cssFilterPreview }}
      />
      {isLast && caption && (
        <p className="mt-3 text-center font-[family-name:var(--font-display)] text-base italic text-[#4a3626]">
          {caption}
        </p>
      )}
    </div>
  );
}

export function PolaroidStrip({
  roundResults,
  caption,
  layout,
  // Applied to every photo as a live, instant approximation of the
  // currently-selected filter — the point being that clicking a filter
  // tile visibly re-tints the *actual* photos immediately, rather than
  // waiting a beat for the real server-side regrade to land. Once it does
  // land, this becomes redundant (the image itself is now graded) and just
  // harmlessly stops mattering — filterPreview should be reset to "none"
  // once state.regradingStrip goes back to false.
  cssFilterPreview = "none",
}: {
  roundResults: RoundResult[];
  caption: string;
  layout: PolaroidLayout;
  cssFilterPreview?: string;
}) {
  const sorted = [...roundResults].sort((a, b) => a.round - b.round);
  const isLastOf = (i: number) => i === sorted.length - 1;

  if (layout === "collage") {
    return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 px-2 py-4">
        {sorted.map((r, i) => (
          <Card
            key={r.round}
            round={r.round}
            compositeUrl={r.compositeUrl}
            caption={caption}
            isLast={isLastOf(i)}
            cssFilterPreview={cssFilterPreview}
            style={{
              transform: `rotate(${COLLAGE_TILTS_DEG[i % COLLAGE_TILTS_DEG.length]}deg)`,
              marginTop: i % 2 === 1 ? 28 : 0,
              ["--tilt" as string]: `${COLLAGE_TILTS_DEG[i % COLLAGE_TILTS_DEG.length]}deg`,
              animationDelay: `${i * 150}ms`,
            }}
          />
        ))}
      </div>
    );
  }

  if (layout === "stack") {
    return (
      <div className="relative py-4" style={{ width: 288, height: 380 }}>
        {sorted.map((r, i) => {
          const fan = STACK_FAN_PX[i % STACK_FAN_PX.length];
          return (
            <div
              key={r.round}
              className="absolute left-1/2 top-6"
              style={{ transform: `translateX(-50%) translate(${fan.dx}px, ${fan.dy}px)`, zIndex: i }}
            >
              <Card
                round={r.round}
                compositeUrl={r.compositeUrl}
                caption={caption}
                isLast={isLastOf(i)}
                cssFilterPreview={cssFilterPreview}
                style={{
                  transform: `rotate(${STACK_TILTS_DEG[i % STACK_TILTS_DEG.length]}deg)`,
                  ["--tilt" as string]: `${STACK_TILTS_DEG[i % STACK_TILTS_DEG.length]}deg`,
                  animationDelay: `${i * 150}ms`,
                }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  // strip (default)
  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {sorted.map((r, i) => {
        const tilt = STRIP_TILTS_DEG[i % STRIP_TILTS_DEG.length];
        const drift = STRIP_DRIFTS_PX[i % STRIP_DRIFTS_PX.length];
        return (
          <Card
            key={r.round}
            round={r.round}
            compositeUrl={r.compositeUrl}
            caption={caption}
            isLast={isLastOf(i)}
            cssFilterPreview={cssFilterPreview}
            style={{
              transform: `translateX(${drift}px) rotate(${tilt}deg)`,
              ["--tilt" as string]: `${tilt}deg`,
              animationDelay: `${i * 150}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
