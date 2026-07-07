"use client";

import { PHOTOBOOTH_FILTERS, type FilterId } from "@/lib/shared/filters";

/** One tile: a real preview of your actual captured photo with that
 * filter's CSS approximation applied — not a generic icon, not a live
 * selfie. Since filters are now only ever picked after the strip already
 * exists, showing the real photo is both truer and cheaper than a live
 * camera feed would be. */
function FilterTile({
  photoUrl,
  filterId,
  label,
  cssPreview,
  selected,
  onSelect,
}: {
  photoUrl: string | null;
  filterId: FilterId;
  label: string;
  cssPreview: string;
  selected: boolean;
  onSelect: (id: FilterId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(filterId)}
      className={`flex shrink-0 flex-col items-center gap-1.5 rounded-xl border-2 p-1.5 transition ${
        selected ? "border-accent bg-accent-soft/40" : "border-transparent hover:border-border"
      }`}
    >
      <div className="h-16 w-16 overflow-hidden rounded-lg bg-zinc-900">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- server-generated, non-static asset
          <img
            src={photoUrl}
            alt={`${label} preview`}
            className="h-full w-full object-cover"
            style={{ filter: cssPreview }}
          />
        ) : (
          <div className="h-full w-full" style={{ filter: cssPreview, background: "#8a8f98" }} />
        )}
      </div>
      <span className={`text-xs font-medium ${selected ? "text-accent-strong" : "opacity-70"}`}>
        {label}
      </span>
    </button>
  );
}

export function FilterPicker({
  photoUrl,
  selectedFilter,
  onSelect,
}: {
  photoUrl: string | null;
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
            photoUrl={photoUrl}
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
