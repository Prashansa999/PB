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
  // A soft mood-color wash — unlike `tint`, this does NOT replace the
  // image's own chroma, it lays a translucent color over it. Right tool for
  // a cinematic cast (neon signage, tungsten light) on an otherwise still
  // colorful image; `tint` would flatten it toward monochrome instead.
  wash?: { r: number; g: number; b: number; alpha: number; blend: "overlay" | "soft-light" };
  // Faked light-trail / step-print smear: N offset, faded, screen-blended
  // copies of the frame layered back on top of itself.
  streak?: { dx: number; dy: number; alpha: number }[];
  // Dreamy halation glow: a blurred copy of the frame is pushed through a
  // highlight-extraction curve (gain/offset — shadows clamp to black, which
  // is neutral under screen blending) and screen-blended back over the
  // original. Bright areas — skin, flash reflections, lights — halo past
  // their edges the way instant-film lenses bloom, while shadows and faces
  // stay sharp. This is most of what makes those photos read "soft and
  // romantic" instead of "webcam".
  bloom?: { sigma: number; gain: number; offset: number; alpha: number };
}

const RECIPES: Record<FilterId, FilterRecipe> = {
  // Not a no-op: a very light contrast/clarity/warmth lift, the kind of
  // invisible processing a phone camera already does before you ever see
  // the shot. The point is that it reads as "a nice photo," not "a photo
  // with a filter on it" — no grain, no vignette, nothing you'd notice
  // unless you compared it side by side with the raw frame.
  none: {
    modulate: { brightness: 1.015, saturation: 1.05 },
    linear: { a: 1.03, b: -2 },
  },
  // The default look. Warm, soft, gently faded instant-film — the cozy
  // Instax-on-fairy-lights aesthetic, tuned to flatter skin and feel like a
  // keepsake, not a webcam grab. A hair warmer and softer than a phone
  // photo, but still natural, never heavy-handed.
  //
  // Warmth comes from a soft-light `wash`, NOT `tint`: sharp's tint()
  // replaces the image's chroma entirely (see the sepia note below), so a
  // tint here would strip all the color out of the photo and leave a
  // warm-toned monochrome — real Instax keeps its color, just muted and
  // creamy.
  film: {
    modulate: { brightness: 1.04, saturation: 0.9 },
    linear: { a: 0.92, b: 14 }, // milky lifted blacks — the soft film fade
    wash: { r: 255, g: 216, b: 178, alpha: 0.12, blend: "soft-light" },
    bloom: { sigma: 16, gain: 1.9, offset: -135, alpha: 0.62 },
    grainAlpha: 0.05,
    vignetteStrength: 0.12,
  },
  retro: {
    modulate: { brightness: 1.03, saturation: 1.02, hue: -5 },
    linear: { a: 0.94, b: 9 },
    wash: { r: 255, g: 200, b: 150, alpha: 0.16, blend: "soft-light" },
    bloom: { sigma: 12, gain: 1.6, offset: -90, alpha: 0.5 },
    grainAlpha: 0.055,
    vignetteStrength: 0.11,
  },
  noir: {
    greyscale: true,
    linear: { a: 1.08, b: -5 },
    vignetteStrength: 0.08,
  },
  sepia: {
    // Deliberately no `greyscale: true` here: sharp's tint() already
    // replaces chroma while preserving luminance, which *is* the
    // monochrome-tone effect we want. Chaining greyscale() first collapses
    // the image to a 1-channel buffer that tint() then silently no-ops on
    // — cost me a debugging session to find, worth remembering.
    tint: { r: 196, g: 138, b: 76 },
    linear: { a: 1.03, b: -3 },
  },
  dreamy: {
    modulate: { brightness: 1.06, saturation: 0.93 },
    linear: { a: 0.92, b: 12 },
    bloom: { sigma: 24, gain: 2.4, offset: -190, alpha: 0.85 }, // the heaviest glow in the catalog
    grainAlpha: 0.02,
    vignetteStrength: 0.05,
  },
  vivid: {
    modulate: { brightness: 1.02, saturation: 1.22 },
    linear: { a: 1.04, b: -2 },
  },
  flash: {
    modulate: { brightness: 1.1, saturation: 1.03 },
    linear: { a: 1.03, b: 0 },
    grainAlpha: 0.03,
    vignetteStrength: 0.02,
  },
  // The next two are a style homage to Christopher Doyle's cinematography
  // on Chungking Express / Fallen Angels: pushed, grainy 35mm, saturated
  // neon color with crushed contrast — not a copy of any frame from the
  // film, just the same *kind* of grade (the way "film" or "noir" above
  // are genres, not specific stocks or movies). Kept restrained rather
  // than pushed to the extreme of the source material — the goal here is
  // still a photo people want to keep, not a screengrab.
  chungking: {
    modulate: { brightness: 0.99, saturation: 1.18, hue: 3 },
    linear: { a: 1.1, b: -8 },
    wash: { r: 255, g: 140, b: 60, alpha: 0.07, blend: "soft-light" },
    grainAlpha: 0.06,
    vignetteStrength: 0.14,
  },
  neon: {
    modulate: { brightness: 0.98, saturation: 1.2, hue: 4 },
    linear: { a: 1.1, b: -8 },
    wash: { r: 255, g: 100, b: 160, alpha: 0.06, blend: "soft-light" },
    grainAlpha: 0.05,
    vignetteStrength: 0.13,
    streak: [
      { dx: 5, dy: 2, alpha: 0.14 },
      { dx: 10, dy: 4, alpha: 0.07 },
    ],
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

async function buildWash(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
  alpha: number
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .ensureAlpha(alpha)
    .png()
    .toBuffer();
}

/** Bakes the chosen filter's real pixel processing into a frame. This is
 * the authoritative output — what gets composited into the strip and what
 * downloads. The client's CSS preview (applied to actual captured-photo
 * thumbnails in the filter picker, and optimistically to the displayed
 * strip right after a click) is just a cheap approximation of this,
 * replaced by the real thing once the server-side regrade lands. */
export async function applyFilter(input: Buffer, filterId: FilterId): Promise<Buffer> {
  const recipe = RECIPES[filterId];
  if (!recipe) return input;

  let pipeline = sharp(input);
  // tint() already desaturates-toward-a-hue on its own (see the comment on
  // the sepia recipe above) — greyscale() first would collapse to a
  // 1-channel buffer that tint() then silently ignores.
  if (recipe.greyscale && !recipe.tint) pipeline = pipeline.greyscale();
  if (recipe.tint) pipeline = pipeline.tint(recipe.tint);
  if (recipe.modulate) pipeline = pipeline.modulate(recipe.modulate);
  if (recipe.linear) pipeline = pipeline.linear(recipe.linear.a, recipe.linear.b);

  let buffer = await pipeline.toBuffer();
  const { width = 0, height = 0 } = await sharp(buffer).metadata();

  // Halation bloom — see the FilterRecipe comment. Blur first (spread the
  // light), then the gain/offset curve keeps only what was bright enough
  // to glow, then screen-blend it back over the sharp original.
  if (recipe.bloom) {
    const { sigma, gain, offset, alpha } = recipe.bloom;
    const glow = await sharp(buffer)
      .blur(sigma)
      .linear(gain, offset)
      .ensureAlpha(alpha)
      .png()
      .toBuffer();
    buffer = await sharp(buffer).composite([{ input: glow, blend: "screen" }]).toBuffer();
  }

  // Light-trail smear: offset, faded, screen-blended copies of the frame
  // laid back on top of itself. Screen blend brightens like a real light
  // trail rather than just ghosting a dark double-exposure.
  if (recipe.streak && recipe.streak.length > 0) {
    const layers = await Promise.all(
      recipe.streak.map((s) => sharp(buffer).ensureAlpha(s.alpha).png().toBuffer())
    );
    buffer = await sharp(buffer)
      .composite(
        recipe.streak.map((s, i) => ({
          input: layers[i],
          left: Math.round(s.dx),
          top: Math.round(s.dy),
          blend: "screen" as const,
        }))
      )
      .toBuffer();
  }

  if (recipe.wash || recipe.grainAlpha || recipe.vignetteStrength) {
    const overlays: { input: Buffer; blend: "over" | "multiply" | "overlay" | "soft-light" }[] = [];

    if (recipe.wash) {
      const { r, g, b, alpha, blend } = recipe.wash;
      overlays.push({ input: await buildWash(width, height, { r, g, b }, alpha), blend });
    }
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
