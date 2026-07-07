"use client";

import type { RoundResult } from "@/lib/client/useRoomSession";

const TILTS_DEG = [-4, 3, -3.5, 4.5];
const DRIFTS_PX = [-10, 8, -6, 10];

export function PolaroidStrip({
  roundResults,
  caption,
}: {
  roundResults: RoundResult[];
  caption: string;
}) {
  const sorted = [...roundResults].sort((a, b) => a.round - b.round);

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {sorted.map((r, i) => {
        const tilt = TILTS_DEG[i % TILTS_DEG.length];
        const drift = DRIFTS_PX[i % DRIFTS_PX.length];
        const isLast = i === sorted.length - 1;
        return (
          <div
            key={r.round}
            className="polaroid-card rounded-md bg-white p-3 pb-6 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.35)]"
            style={{
              transform: `translateX(${drift}px) rotate(${tilt}deg)`,
              // Read by the polaroid-drop keyframe as its resting rotation.
              ["--tilt" as string]: `${tilt}deg`,
              animationDelay: `${i * 150}ms`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- server-generated, non-static asset */}
            <img
              src={r.compositeUrl}
              alt={`Photo ${r.round + 1}`}
              className="w-64 rounded-sm sm:w-72"
            />
            {isLast && caption && (
              <p className="mt-3 text-center font-[family-name:var(--font-display)] text-base italic text-[#4a3626]">
                {caption}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
