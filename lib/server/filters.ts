import sharp from "sharp";
import type { FilterId } from "../shared/filters";

interface FilterRecipe {
  greyscale?: boolean;
  // Applied after an optional greyscale pass — sharp's documented way to
  // get a sepia/mono tone is greyscale() followed by tint().
  tint?: { r: number; g: number; b: number };
  modulate?: { brightness?: number; saturation?: number; hue?: number };
  // Simple linear contrast/brightness: output = a * input + b
  linear?: { a: number; b: number };
  // 0-1 opacity of a generated grain layer, composited with normal alpha
  // blending (the grain image's own alpha channel carries the strength).
  grainAlpha?: number;
  // 0-1 strength of a radial-darkening vignette composited with 'multiply'.
  vignetteStrength?: number;
}

const RECIPES: Record<FilterId, FilterRecipe> = {
  none: {},
  film: {
    modulate: { brightness: 1.03, saturation: 0.85 },
    tint: { r: 255, g: 244, b: 230 },
    grainAlpha: 0.06,
    vignetteStrength: 0.15,
  },
  retro: {
    modulate: { brightness: 1.05, saturation: 1.15, hue: -6 },
    tint: { r: 255, g: 230, b: 190 },
    linear: { a: 0.92, b: 10 },
    grainAlpha: 0.1,
    vignetteStrength: 0.25,
  },
  noir: {
    greyscale: true,
    linear: { a: 1.15, b: -10 },
    vignetteStrength: 0.2,
  },
  sepia: {
    // Deliberately no `greyscale: true` here: sharp's tint() already
    // replaces chroma while preserving luminance, which *is* the
    // monochrome-tone effect we want. Chaining greyscale() first collapses
    // the image to a 1-channel buffer that tint() then silently no-ops on
    // — cost me a debugging session to find, worth remembering.
    tint: { r: 196, g: 138, b: 76 },
    linear: { a: 1.08, b: -8 },
  },
  dreamy: {
    modulate: { brightness: 1.12, saturation: 0.9 },
    linear: { a: 0.88, b: 15 },
    grainAlpha: 0.03,
    vignetteStrength: 0.1,
  },
  vivid: {
    modulate: { brightness: 1.03, saturation: 1.5 },
    linear: { a: 1.1, b: -5 },
  },
  flash: {
    modulate: { brightness: 1.2, saturation: 1.05 },
    linear: { a: 1.08, b: 0 },
    grainAlpha: 0.08,
    vignetteStrength: 0.05,
  },
};

async function buildGrain(width: number, height: number, alpha: number): Promise<Buffer> {
  const noise = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  })
    .greyscale()
    .png()
    .toBuffer();
  return sharp(noise).ensureAlpha(alpha).png().toBuffer();
}

async function buildVignette(width: number, height: number, strength: number): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="black" stop-opacity="0" />
        <stop offset="100%" stop-color="black" stop-opacity="${strength}" />
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#v)" />
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Bakes the chosen filter's real pixel processing into a frame. This is
 * the authoritative output — what gets composited into the strip, what
 * downloads, what gets printed on the magnet. The client's CSS preview is
 * just a cheap approximation of this for the live camera view. */
export async function applyFilter(input: Buffer, filterId: FilterId): Promise<Buffer> {
  const recipe = RECIPES[filterId];
  if (!recipe || filterId === "none") return input;

  let pipeline = sharp(input);
  // tint() already desaturates-toward-a-hue on its own (see the comment on
  // the sepia recipe above) — greyscale() first would collapse to a
  // 1-channel buffer that tint() then silently ignores.
  if (recipe.greyscale && !recipe.tint) pipeline = pipeline.greyscale();
  if (recipe.tint) pipeline = pipeline.tint(recipe.tint);
  if (recipe.modulate) pipeline = pipeline.modulate(recipe.modulate);
  if (recipe.linear) pipeline = pipeline.linear(recipe.linear.a, recipe.linear.b);

  let buffer = await pipeline.toBuffer();

  if (recipe.grainAlpha || recipe.vignetteStrength) {
    const { width = 0, height = 0 } = await sharp(buffer).metadata();
    const overlays: { input: Buffer; blend: "over" | "multiply" }[] = [];

    if (recipe.grainAlpha) {
      overlays.push({ input: await buildGrain(width, height, recipe.grainAlpha), blend: "over" });
    }
    if (recipe.vignetteStrength) {
      overlays.push({ input: await buildVignette(width, height, recipe.vignetteStrength), blend: "multiply" });
    }

    buffer = await sharp(buffer).composite(overlays).toBuffer();
  }

  return buffer;
}
