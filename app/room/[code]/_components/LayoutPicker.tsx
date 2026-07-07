"use client";

import { POLAROID_LAYOUTS, type PolaroidLayout } from "@/lib/shared/layout";

/** A tiny abstract mockup of each arrangement — cheap to render (just
 * divs) and clearer than words for "what does 'collage' actually look
 * like." */
function LayoutGlyph({ layout }: { layout: PolaroidLayout }) {
  const card = "absolute rounded-[2px] bg-white shadow-sm ring-1 ring-black/10";

  if (layout === "collage") {
    return (
      <div className="relative h-16 w-16">
        <div className={card} style={{ left: 6, top: 4, width: 22, height: 26, transform: "rotate(-6deg)" }} />
        <div className={card} style={{ left: 32, top: 10, width: 22, height: 26, transform: "rotate(5deg)" }} />
        <div className={card} style={{ left: 4, top: 32, width: 22, height: 26, transform: "rotate(4deg)" }} />
        <div className={card} style={{ left: 34, top: 36, width: 22, height: 26, transform: "rotate(-5deg)" }} />
      </div>
    );
  }

  if (layout === "stack") {
    return (
      <div className="relative h-16 w-16">
        <div className={card} style={{ left: 10, top: 16, width: 28, height: 34, transform: "rotate(10deg)" }} />
        <div className={card} style={{ left: 20, top: 12, width: 28, height: 34, transform: "rotate(-6deg)" }} />
        <div className={card} style={{ left: 14, top: 10, width: 28, height: 34, transform: "rotate(3deg)" }} />
        <div className={card} style={{ left: 18, top: 8, width: 28, height: 34, transform: "rotate(-2deg)" }} />
      </div>
    );
  }

  // strip
  return (
    <div className="relative h-16 w-16">
      <div className={card} style={{ left: 20, top: 2, width: 26, height: 16, transform: "rotate(-4deg)" }} />
      <div className={card} style={{ left: 18, top: 20, width: 26, height: 16, transform: "rotate(3deg)" }} />
      <div className={card} style={{ left: 20, top: 38, width: 26, height: 16, transform: "rotate(-3deg)" }} />
    </div>
  );
}

export function LayoutPicker({
  selectedLayout,
  onSelect,
}: {
  selectedLayout: PolaroidLayout;
  onSelect: (layout: PolaroidLayout) => void;
}) {
  const active = POLAROID_LAYOUTS.find((l) => l.id === selectedLayout);

  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium opacity-70">Arrange the photos</p>
        {active && <p className="text-xs opacity-50">{active.description}</p>}
      </div>
      <div className="mt-2 flex gap-2">
        {POLAROID_LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onSelect(l.id)}
            className={`flex shrink-0 flex-col items-center gap-1.5 rounded-xl border-2 p-1.5 transition ${
              l.id === selectedLayout ? "border-accent bg-accent-soft/40" : "border-transparent hover:border-border"
            }`}
          >
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-card">
              <LayoutGlyph layout={l.id} />
            </div>
            <span className={`text-xs font-medium ${l.id === selectedLayout ? "text-accent-strong" : "opacity-70"}`}>
              {l.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
