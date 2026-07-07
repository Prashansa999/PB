// The filter catalog lives here (not in lib/client or lib/server) because
// both sides need to agree on the same set of ids: the client uses this to
// render picker tiles and a live CSS-approximated preview, the server uses
// the id to look up the real pixel-processing recipe (lib/server/filters.ts)
// that gets baked into the captured frames. Neither side should invent an
// id the other doesn't know about.

export const FILTER_IDS = [
  "none",
  "film",
  "retro",
  "noir",
  "sepia",
  "dreamy",
  "vivid",
  "flash",
  "chungking",
  "neon",
] as const;

export type FilterId = (typeof FILTER_IDS)[number];

export interface FilterMeta {
  id: FilterId;
  label: string;
  description: string;
  // A CSS `filter` value that approximates the look for the *live* camera
  // preview. Cheap, instant, GPU-composited — but only an approximation.
  // The actual strip is graded server-side in lib/server/filters.ts so the
  // download/print output doesn't depend on any one browser's CSS filter
  // implementation.
  cssPreview: string;
}

export const PHOTOBOOTH_FILTERS: FilterMeta[] = [
  {
    id: "none",
    label: "Original",
    description: "Straight off the camera, no grading.",
    cssPreview: "none",
  },
  {
    id: "film",
    label: "Film",
    description: "Warm, soft, a little grainy — like a disposable camera.",
    cssPreview: "contrast(1.05) saturate(0.85) sepia(0.15) brightness(1.03)",
  },
  {
    id: "retro",
    label: "Retro",
    description: "Faded 70s color with a warm cast and heavier grain.",
    cssPreview: "sepia(0.35) saturate(1.3) contrast(0.9) brightness(1.05) hue-rotate(-8deg)",
  },
  {
    id: "noir",
    label: "Noir",
    description: "Classic high-contrast black & white photobooth strip.",
    cssPreview: "grayscale(1) contrast(1.2) brightness(1.05)",
  },
  {
    id: "sepia",
    label: "Sepia",
    description: "Old-fashioned warm monochrome brown tone.",
    cssPreview: "sepia(0.9) contrast(1.05) brightness(1.02)",
  },
  {
    id: "dreamy",
    label: "Dreamy",
    description: "Soft, bright, low-contrast — a gentle romantic glow.",
    cssPreview: "saturate(0.9) brightness(1.12) contrast(0.9) blur(0.3px)",
  },
  {
    id: "vivid",
    label: "Vivid",
    description: "Punchy, saturated color with crisp contrast.",
    cssPreview: "saturate(1.5) contrast(1.15) brightness(1.03)",
  },
  {
    id: "flash",
    label: "Flash",
    description: "Bright direct-flash party-photobooth look.",
    cssPreview: "brightness(1.2) contrast(1.1) saturate(1.05)",
  },
  {
    id: "chungking",
    label: "Chungking",
    description: "Moody neon nights, saturated and grainy — city-at-midnight energy.",
    cssPreview: "saturate(1.5) contrast(1.3) brightness(0.95) hue-rotate(8deg) sepia(0.12)",
  },
  {
    id: "neon",
    label: "Neon Trails",
    description: "Same neon-night mood, with light trails streaking through.",
    cssPreview: "saturate(1.6) contrast(1.3) brightness(0.94) hue-rotate(10deg) blur(0.4px)",
  },
];

export function isFilterId(value: string): value is FilterId {
  return (FILTER_IDS as readonly string[]).includes(value);
}
