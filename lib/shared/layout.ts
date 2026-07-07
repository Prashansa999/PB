// Like filters.ts: both client and server need to agree on the same set of
// layout ids. The client uses this for the picker UI; the server uses the
// id to decide how to arrange the round composites into the final strip
// (lib/server/compositor.ts).

export const POLAROID_LAYOUT_IDS = ["strip", "collage", "stack"] as const;

export type PolaroidLayout = (typeof POLAROID_LAYOUT_IDS)[number];

export interface PolaroidLayoutMeta {
  id: PolaroidLayout;
  label: string;
  description: string;
}

export const POLAROID_LAYOUTS: PolaroidLayoutMeta[] = [
  {
    id: "strip",
    label: "Strip",
    description: "The classic photobooth column, one photo after another.",
  },
  {
    id: "collage",
    label: "Collage",
    description: "Scattered two-up, like a Pinterest moodboard.",
  },
  {
    id: "stack",
    label: "Stack",
    description: "Fanned out in a pile, like they were just tossed down.",
  },
];

export function isPolaroidLayout(value: string): value is PolaroidLayout {
  return (POLAROID_LAYOUT_IDS as readonly string[]).includes(value);
}
