"use client";

import { useEffect, useRef } from "react";
import { PHOTOBOOTH_FILTERS, type FilterId } from "@/lib/shared/filters";

/** One tile: the user's own live camera feed, small, with that filter's CSS
 * approximation applied — a real live preview, not a static icon. Multiple
 * <video> elements can all bind to the same MediaStream simultaneously,
 * which is what makes rendering N of these at once cheap. */
function FilterTile({
  stream,
  filterId,
  label,
  cssPreview,
  selected,
  onSelect,
}: {
  stream: MediaStream | null;
  filterId: FilterId;
  label: string;
  cssPreview: string;
  selected: boolean;
  onSelect: (id: FilterId) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <button
      type="button"
      onClick={() => onSelect(filterId)}
      className={`flex shrink-0 flex-col items-center gap-1.5 rounded-xl border-2 p-1.5 transition ${
        selected ? "border-accent bg-accent-soft/40" : "border-transparent hover:border-border"
      }`}
    >
      <div className="h-16 w-16 overflow-hidden rounded-lg bg-zinc-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)", filter: cssPreview }}
        />
      </div>
      <span className={`text-xs font-medium ${selected ? "text-accent-strong" : "opacity-70"}`}>
        {label}
      </span>
    </button>
  );
}

export function FilterPicker({
  stream,
  selectedFilter,
  onSelect,
}: {
  stream: MediaStream | null;
  selectedFilter: FilterId;
  onSelect: (id: FilterId) => void;
}) {
  const active = PHOTOBOOTH_FILTERS.find((f) => f.id === selectedFilter);

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium opacity-70">Pick a filter — you&rsquo;ll both get it</p>
        {active && <p className="text-xs opacity-50">{active.description}</p>}
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {PHOTOBOOTH_FILTERS.map((f) => (
          <FilterTile
            key={f.id}
            stream={stream}
            filterId={f.id}
            label={f.label}
            cssPreview={f.cssPreview}
            selected={f.id === selectedFilter}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
