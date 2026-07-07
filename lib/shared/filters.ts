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
    id: "film",
    label: "Film",
    description: "Warm, soft instant-film glow — the cozy default. 🤍",
    cssPreview: "sepia(0.14) saturate(0.99) contrast(0.97) brightness(1.04)",
  },
  {
    id: "none",
    label: "Original",
    description: "A natural, true-to-life look — clean and unfiltered.",
    cssPreview: "contrast(1.03) saturate(1.05) brightness(1.015)",
  },
  {
    id: "retro",
    label: "Retro",
    description: "A gentle warm, faded cast — vintage without looking staged.",
    cssPreview: "sepia(0.12) saturate(1.08) contrast(0.97) brightness(1.03) hue-rotate(-4deg)",
  },
  {
    id: "noir",
    label: "Noir",
    description: "Clean black & white with natural contrast.",
    cssPreview: "grayscale(1) contrast(1.08) brightness(1.02)",
  },
  {
    id: "sepia",
    label: "Sepia",
    description: "Soft, warm monochrome — old-fashioned, not heavy-handed.",
    cssPreview: "sepia(0.75) contrast(1.02) brightness(1.01)",
  },
  {
    id: "dreamy",
    label: "Dreamy",
    description: "Soft and bright with a gentle glow — still looks like a real photo.",
    cssPreview: "saturate(0.96) brightness(1.06) contrast(0.95)",
  },
  {
    id: "vivid",
    label: "Vivid",
    description: "A little more color and pop, kept believable.",
    cssPreview: "saturate(1.2) contrast(1.04) brightness(1.02)",
  },
  {
    id: "flash",
    label: "Flash",
    description: "Bright and clean, like a well-lit party photo.",
    cssPreview: "brightness(1.08) contrast(1.03) saturate(1.03)",
  },
  {
    id: "chungking",
    label: "Chungking",
    description: "Moody neon-night color, kept subtle enough to still look real.",
    cssPreview: "saturate(1.18) contrast(1.08) brightness(0.99) hue-rotate(3deg)",
  },
  {
    id: "neon",
    label: "Neon Trails",
    description: "Same neon-night mood, with a faint light trail through it.",
    cssPreview: "saturate(1.2) contrast(1.08) brightness(0.98) hue-rotate(4deg)",
  },
];

export function isFilterId(value: string): value is FilterId {
  return (FILTER_IDS as readonly string[]).includes(value);
}
