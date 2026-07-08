import sharp from "sharp";
import GIFEncoder from "gif-encoder-2";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { applyFilter } from "./filters";
import type { FilterId } from "../shared/filters";
import type { PolaroidLayout } from "../shared/layout";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "strips");

// Each participant's frame is center-cropped to this fixed rectangle before
// being placed side-by-side, so the strip looks consistent regardless of
// whether a partner is on a portrait phone or a landscape webcam.
const TILE_WIDTH = 620;
const TILE_HEIGHT = 620;
const GUTTER = 10;
const BORDER = 18;

// Instant-film paper stock: clean, bright white with only a breath of
// warmth. Real Instax frames are notably *white* — an earlier, creamier
// value blended into the warm backdrop and read dingy instead of crisp;
// this needs to stay just off pure #fff so the cards pop against the
// peachy background the way a real print does on a warm surface.
const PAPER = { r: 255, g: 255, b: 253 };

async function ensureRoomDir(code: string): Promise<string> {
  const dir = path.join(STORAGE_ROOT, code);
  await mkdir(dir, { recursive: true });
  return dir;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return Buffer.from(base64, "base64");
}

export function decodeCapturedFrame(dataUrl: string): Buffer {
  return dataUrlToBuffer(dataUrl);
}

/** Portrait-mode-ish background blur without ML: a soft radial focus that
 * keeps the center of the tile (where a photobooth subject sits) sharp and
 * blurs outward. Works per-tile — each person is roughly centered in their
 * own half of the frame, so their own background softens while they stay
 * crisp. Reliable and offline (no segmentation model), which is why it's an
 * option rather than trying to be true person-cutout portrait mode. */
async function applyBackgroundBlur(tile: Buffer): Promise<Buffer> {
  const blurred = await sharp(tile).blur(9).toBuffer();

  // A radial mask: opaque white over the central subject area, fading to
  // transparent toward the edges. Used as a dest-in mask so only the sharp
  // center survives, composited over the fully-blurred base.
  const mask = Buffer.from(
    `<svg width="${TILE_WIDTH}" height="${TILE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="focus" cx="50%" cy="46%" r="62%">
          <stop offset="0%" stop-color="#fff" stop-opacity="1" />
          <stop offset="55%" stop-color="#fff" stop-opacity="1" />
          <stop offset="100%" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="${TILE_WIDTH}" height="${TILE_HEIGHT}" fill="url(#focus)" />
    </svg>`
  );

  const sharpCenter = await sharp(tile)
    .ensureAlpha()
    .composite([{ input: await sharp(mask).png().toBuffer(), blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(blurred).composite([{ input: sharpCenter, blend: "over" }]).png().toBuffer();
}

async function centerCropToTile(
  input: Buffer,
  filterId: FilterId,
  backgroundBlur: boolean
): Promise<Buffer> {
  let tile: Buffer = await sharp(input)
    .rotate() // respect EXIF orientation from mobile cameras
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "cover", position: "attention" })
    .toBuffer();
  // Order matters: soften the background first (on clean pixels), THEN run
  // the filter so its grain/vignette lands uniformly over the whole tile
  // rather than getting smeared by the blur.
  if (backgroundBlur) tile = await applyBackgroundBlur(tile);
  return applyFilter(tile, filterId);
}

/**
 * Composites one round: host frame + guest frame side by side, framed with a
 * warm booth border. Returns the PNG buffer and writes it to disk, returning
 * a URL the client can fetch it from.
 */
export async function compositeRound(
  code: string,
  round: number,
  hostFrame: Buffer,
  guestFrame: Buffer,
  filterId: FilterId,
  backgroundBlur: boolean
): Promise<{ buffer: Buffer; url: string }> {
  const [hostTile, guestTile] = await Promise.all([
    centerCropToTile(hostFrame, filterId, backgroundBlur),
    centerCropToTile(guestFrame, filterId, backgroundBlur),
  ]);

  const width = TILE_WIDTH * 2 + GUTTER + BORDER * 2;
  const height = TILE_HEIGHT + BORDER * 2;

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: PAPER,
    },
  })
    .composite([
      { input: hostTile, left: BORDER, top: BORDER },
      { input: guestTile, left: BORDER + TILE_WIDTH + GUTTER, top: BORDER },
    ])
    .png()
    .toBuffer();

  const dir = await ensureRoomDir(code);
  const filename = `round-${round}.png`;
  await writeFile(path.join(dir, filename), buffer);

  return { buffer, url: `/api/strip-image/${code}/${filename}` };
}

// Instax-mini-style frame proportions: slim, even top/side borders and a
// noticeably deeper bottom "chin" for the handwritten caption.
const POLAROID_SIDE_MARGIN = 32;
const POLAROID_TOP_MARGIN = 32;
const POLAROID_BOTTOM_MARGIN = 132; // the classic instant-photo caption strip
const POLAROID_CORNER_RADIUS = 18;
// Tight — the cards should read as one strip fresh off the booth, nearly
// touching, not four separate photos floating apart.
const POLAROID_GAP = 14;
const CANVAS_PADDING = 88;
const HEADER_HEIGHT = 100;
const SHADOW_OFFSET = 4;

// Per-layout, deterministic (not random) tilt angles and placement
// constants — deterministic so a given session's arrangement is stable if
// the strip is ever regenerated (filter change, caption edit).
const ROTATIONS_DEG: Record<PolaroidLayout, number[]> = {
  // Barely-there tilts on the strip — with the cards sitting this close,
  // bigger angles collide and read messy instead of casual.
  strip: [-1.8, 1.4, -1.5, 2],
  collage: [-6, 4, -5, 6],
  stack: [-11, 7, -8, 12],
};
const STRIP_DRIFT_PX = [-8, 6, -5, 8];
const STACK_FAN_PX: { dx: number; dy: number }[] = [
  { dx: -34, dy: 0 },
  { dx: 16, dy: 14 },
  { dx: -14, dy: 30 },
  { dx: 32, dy: 40 },
];

// Cursive-first font stack for the handwritten bits. On the server rsvg
// falls back to a plain face (no script fonts installed), so we lean on
// italic to at least suggest handwriting there; on-device the on-screen
// cards get a real script font from the same stack.
const HANDWRITING = "'Segoe Script','Snell Roundhand','Bradley Hand','Comic Sans MS',cursive";

async function buildWhitePolaroidCard(
  photo: Buffer,
  captionText: string | null,
  dateLabel: string | null
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { width: photoWidth = 0, height: photoHeight = 0 } = await sharp(photo).metadata();
  const cardWidth = photoWidth + POLAROID_SIDE_MARGIN * 2;
  const cardHeight = photoHeight + POLAROID_TOP_MARGIN + POLAROID_BOTTOM_MARGIN;
  const chinTop = photoHeight + POLAROID_TOP_MARGIN;

  const overlays: { input: Buffer; left: number; top: number }[] = [
    { input: photo, left: POLAROID_SIDE_MARGIN, top: POLAROID_TOP_MARGIN },
  ];

  // A faint recessed keyline around the photo — real instant film has a
  // slight bevel where the emulsion meets the frame. Sells "printed photo"
  // over "image pasted on a white box".
  const keylineSvg = Buffer.from(
    `<svg width="${photoWidth}" height="${photoHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.75" y="0.75" width="${photoWidth - 1.5}" height="${photoHeight - 1.5}"
        fill="none" stroke="#000" stroke-opacity="0.14" stroke-width="1.5"/>
    </svg>`
  );
  overlays.push({ input: keylineSvg, left: POLAROID_SIDE_MARGIN, top: POLAROID_TOP_MARGIN });

  if (captionText) {
    const escaped = captionText.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const captionSvg = Buffer.from(
      `<svg width="${cardWidth}" height="${POLAROID_BOTTOM_MARGIN}" xmlns="http://www.w3.org/2000/svg">
        <text x="50%" y="44%" text-anchor="middle" dominant-baseline="middle"
          font-family="${HANDWRITING}" font-style="italic"
          font-size="44" fill="#6b4a3a">${escaped}</text>
      </svg>`
    );
    overlays.push({ input: captionSvg, left: 0, top: chinTop });
  }

  // The date, handwritten in the corner of the chin — like people actually
  // date their instants. Once per strip (on the last card, alongside the
  // caption), not stamped on all four.
  if (dateLabel) {
    const dateSvg = Buffer.from(
      `<svg width="${cardWidth}" height="${POLAROID_BOTTOM_MARGIN}" xmlns="http://www.w3.org/2000/svg">
        <text x="${cardWidth - POLAROID_SIDE_MARGIN}" y="${captionText ? "80%" : "56%"}"
          text-anchor="end" dominant-baseline="middle"
          font-family="${HANDWRITING}" font-style="italic"
          font-size="30" fill="#b08c72">${dateLabel}</text>
      </svg>`
    );
    overlays.push({ input: dateSvg, left: 0, top: chinTop });
  }

  let card = await sharp({
    create: { width: cardWidth, height: cardHeight, channels: 3, background: PAPER },
  })
    .composite(overlays)
    .png()
    .toBuffer();

  // Round the corners: an alpha mask shaped like a rounded rect, applied
  // with dest-in so anything outside it (including the square corners of
  // the white background) becomes transparent.
  const maskSvg = Buffer.from(
    `<svg width="${cardWidth}" height="${cardHeight}"><rect width="${cardWidth}" height="${cardHeight}"
      rx="${POLAROID_CORNER_RADIUS}" ry="${POLAROID_CORNER_RADIUS}" fill="#fff"/></svg>`
  );
  card = await sharp(card)
    .ensureAlpha()
    .composite([{ input: await sharp(maskSvg).png().toBuffer(), blend: "dest-in" }])
    .png()
    .toBuffer();

  return { buffer: card, width: cardWidth, height: cardHeight };
}

async function buildCardShadow(width: number, height: number): Promise<Buffer> {
  // A soft, warm-neutral drop shadow with generous padding so the heavy
  // blur doesn't clip at the edges. Lower opacity + larger blur than before
  // reads as a photo resting on a surface, not a hard cutout.
  const pad = 40;
  const svg = Buffer.from(
    `<svg width="${width + pad * 2}" height="${height + pad * 2}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${pad}" y="${pad}" width="${width}" height="${height}"
        rx="${POLAROID_CORNER_RADIUS}" ry="${POLAROID_CORNER_RADIUS}"
        fill="#3a2418" fill-opacity="0.24"/></svg>`
  );
  return sharp(await sharp(svg).png().toBuffer())
    .blur(22)
    .png()
    .toBuffer();
}

// Deterministic pseudo-random from an integer seed — keeps the bokeh
// backdrop stable across regenerations of the same strip.
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A cozy, softly-lit backdrop for the whole strip: a warm vertical
 * gradient with scattered out-of-focus golden "fairy light" bokeh, echoing
 * the string-light photos couples actually pin their instants over.
 *
 * The bokeh softness comes from a raster Gaussian blur (sharp/libvips)
 * rather than an SVG `<feGaussianBlur>` filter region: librsvg re-runs its
 * (CPU-bound) filter rasterizer per filtered group, which on a strip-sized
 * canvas with ~90 lights was the single biggest cost in the whole reveal
 * pipeline (~3.4s of it). Rendering the lights flat, then blurring the
 * rendered pixels directly, produces the identical soft-glow look in a
 * fraction of the time — no visual change, just a faster path to it. */
async function buildBackdrop(width: number, height: number): Promise<Buffer> {
  const glows: string[] = []; // big, soft, out-of-focus halos
  const cores: string[] = []; // tiny bright centers, the "bulb" itself
  const count = Math.max(12, Math.round((width * height) / 70000));
  for (let i = 0; i < count; i++) {
    const cx = seeded(i * 3 + 1) * width;
    const cy = seeded(i * 3 + 2) * height;
    const r = 20 + seeded(i * 3 + 3) * 70;
    const op = 0.16 + seeded(i * 7 + 5) * 0.42;
    // Mostly golden fairy lights with the occasional blush-pink one mixed
    // in — the two-tone string lights of a bedroom wall, not a uniform
    // yellow wash. Roughly a quarter go pink.
    const fill = seeded(i * 17 + 6) > 0.74 ? "url(#glowPink)" : "url(#glow)";
    glows.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="${op.toFixed(2)}"/>`
    );
    // Only some glows get a visible bright core, for that twinkle variance.
    if (seeded(i * 5 + 9) > 0.45) {
      const cr = 2 + seeded(i * 11 + 2) * 4;
      cores.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${cr.toFixed(1)}" fill="#fff6df" opacity="${(0.5 + seeded(i * 13 + 4) * 0.4).toFixed(2)}"/>`
      );
    }
  }

  const gradientSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fdf1e7"/>
          <stop offset="55%" stop-color="#f8e5d4"/>
          <stop offset="100%" stop-color="#f1d9c4"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
    </svg>`
  );
  const lightsSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffeaba" stop-opacity="1"/>
          <stop offset="40%" stop-color="#ffd98a" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#ffd98a" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="glowPink" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffdbe4" stop-opacity="1"/>
          <stop offset="40%" stop-color="#ffb8cb" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#ffb8cb" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <g>${glows.join("")}</g>
      <g>${cores.join("")}</g>
    </svg>`
  );

  const [gradient, lightsBlurred] = await Promise.all([
    sharp(gradientSvg).png().toBuffer(),
    sharp(lightsSvg).png().blur(7).toBuffer(),
  ]);

  return sharp(gradient).composite([{ input: lightsBlurred, blend: "over" }]).png().toBuffer();
}

async function rotateWithTransparentPadding(
  buffer: Buffer,
  angleDeg: number
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const rotated = await sharp(buffer)
    .ensureAlpha()
    .rotate(angleDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { width = 0, height = 0 } = await sharp(rotated).metadata();
  return { buffer: rotated, width, height };
}

interface RotatedCard {
  buffer: Buffer;
  width: number;
  height: number;
}

interface LayoutResult {
  width: number;
  height: number;
  placements: { left: number; top: number }[];
}

/** Vertical column, the classic photobooth strip — each card centered with
 * a small alternating horizontal drift. */
function layoutStrip(cards: RotatedCard[]): LayoutResult {
  const maxWidth = Math.max(...cards.map((c) => c.width));
  const maxDrift = Math.max(...STRIP_DRIFT_PX.map(Math.abs));
  const width = maxWidth + maxDrift * 2 + CANVAS_PADDING * 2;

  let y = HEADER_HEIGHT;
  const placements = cards.map((c, i) => {
    const drift = STRIP_DRIFT_PX[i % STRIP_DRIFT_PX.length];
    const left = Math.round((width - c.width) / 2 + drift);
    const top = y;
    y += c.height + POLAROID_GAP;
    return { left, top };
  });

  return { width, height: y - POLAROID_GAP + CANVAS_PADDING, placements };
}

/** Two-up scattered grid with the second column staggered down — the
 * masonry-ish, not-quite-aligned arrangement a Pinterest moodboard has,
 * rather than a rigid photo grid. */
function layoutCollage(cards: RotatedCard[]): LayoutResult {
  const colGap = 20;
  const rowGap = 26;
  const columnStagger = 64;
  const maxWidth = Math.max(...cards.map((c) => c.width));
  const maxHeight = Math.max(...cards.map((c) => c.height));
  const width = maxWidth * 2 + colGap + CANVAS_PADDING * 2;

  const placements = cards.map((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const left = CANVAS_PADDING + col * (maxWidth + colGap) + Math.round((maxWidth - c.width) / 2);
    const top = HEADER_HEIGHT + (col === 1 ? columnStagger : 0) + row * (maxHeight + rowGap);
    return { left, top };
  });

  const maxBottom = Math.max(...placements.map((p, i) => p.top + cards[i].height));
  return { width, height: maxBottom + CANVAS_PADDING, placements };
}

/** All four cards fanned out from roughly the same center point, like a
 * pile of real Polaroids someone just set down — later rounds drawn on
 * top, so the most recent photo (and the caption, which always lands on
 * the last round) ends up the most visible one. */
function layoutStack(cards: RotatedCard[]): LayoutResult {
  const maxWidth = Math.max(...cards.map((c) => c.width));
  const fanSpread = Math.max(...STACK_FAN_PX.map((f) => Math.abs(f.dx))) * 2;
  const width = maxWidth + fanSpread + CANVAS_PADDING * 2;
  const centerX = width / 2;
  const top0 = HEADER_HEIGHT + 10;

  const placements = cards.map((c, i) => {
    const fan = STACK_FAN_PX[i % STACK_FAN_PX.length];
    const left = Math.round(centerX - c.width / 2 + fan.dx);
    const top = Math.round(top0 + fan.dy);
    return { left, top };
  });

  const maxBottom = Math.max(...placements.map((p, i) => p.top + cards[i].height));
  return { width, height: maxBottom + CANVAS_PADDING, placements };
}

function computeLayout(layout: PolaroidLayout, cards: RotatedCard[]): LayoutResult {
  if (layout === "collage") return layoutCollage(cards);
  if (layout === "stack") return layoutStack(cards);
  return layoutStrip(cards);
}

/**
 * Turns every round's composite into a rotated, drop-shadowed polaroid card
 * and arranges them per the chosen layout (strip / collage / stack) — never
 * a rigid, obviously-generated grid. The last card gets the shared caption
 * (if any) handwritten into its bottom margin, the way people actually
 * write on real Polaroids.
 */
export async function assembleFinalStrip(
  code: string,
  roundBuffers: Buffer[],
  caption: string,
  layout: PolaroidLayout
): Promise<{ url: string }> {
  const rotations = ROTATIONS_DEG[layout];
  // Short, handwritten-style date for the corner of each instant (M.D.YY).
  const now = new Date();
  const cardDate = `${now.getMonth() + 1}.${now.getDate()}.${String(now.getFullYear()).slice(-2)}`;

  // Each round's card -> rotate -> shadow chain is independent of every
  // other round's, so run all four chains fully concurrently rather than
  // three sequential Promise.all barriers (which would make every round
  // wait for the slowest of the previous stage before starting its next).
  const perCard = await Promise.all(
    roundBuffers.map(async (buf, i) => {
      const isLast = i === roundBuffers.length - 1;
      const card = await buildWhitePolaroidCard(
        buf,
        isLast ? caption || null : null,
        isLast ? cardDate : null
      );
      const rotated = await rotateWithTransparentPadding(card.buffer, rotations[i % rotations.length]);
      const shadow = await buildCardShadow(rotated.width, rotated.height);
      return { rotated, shadow };
    })
  );
  const rotated = perCard.map((c) => c.rotated);
  const shadows = perCard.map((c) => c.shadow);

  const { width, height, placements } = computeLayout(layout, rotated);

  const headerSvg = Buffer.from(
    `<svg width="${width}" height="${HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="44%" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="46" font-weight="700" fill="#b45309">us, together 🤍</text>
      <text x="50%" y="82%" text-anchor="middle"
        font-family="'Segoe Script','Snell Roundhand','Bradley Hand',cursive"
        font-size="26" fill="#a8836a">at the same second</text>
    </svg>`
  );

  // The shadow padding (see buildCardShadow) means the shadow buffer is
  // larger than the card by `pad` on every side; offset it back by that pad
  // so the shadow sits centered under the card rather than down-right of it.
  const shadowPad = 40;
  const composites: { input: Buffer; left: number; top: number }[] = [
    { input: headerSvg, left: 0, top: 0 },
  ];
  for (let i = 0; i < rotated.length; i++) {
    const { left, top } = placements[i];
    // Shadow immediately followed by its own card, per card — not all
    // shadows then all cards — so overlapping cards (collage/stack) layer
    // correctly instead of every shadow sitting under every card.
    composites.push({
      input: shadows[i],
      left: left - shadowPad + SHADOW_OFFSET,
      top: top - shadowPad + SHADOW_OFFSET,
    });
    composites.push({ input: rotated[i].buffer, left, top });
  }

  const buffer = await sharp(await buildBackdrop(width, height))
    .composite(composites)
    .png()
    .toBuffer();

  const dir = await ensureRoomDir(code);
  const filename = "strip.png";
  await writeFile(path.join(dir, filename), buffer);

  return { url: `/api/strip-image/${code}/${filename}` };
}

/**
 * Builds the "clip" output the landing page promises alongside the PNG: a
 * short looping animated GIF cycling through each round's composite.
 */
export async function assembleClip(
  code: string,
  roundBuffers: Buffer[]
): Promise<{ url: string }> {
  const CLIP_WIDTH = 360;
  const CLIP_HEIGHT = 180;
  const FRAME_DELAY_MS = 700;

  const encoder = new GIFEncoder(CLIP_WIDTH, CLIP_HEIGHT, "neuquant", true, roundBuffers.length);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(FRAME_DELAY_MS);
  encoder.setQuality(10);

  for (const buf of roundBuffers) {
    const { data } = await sharp(buf)
      .resize(CLIP_WIDTH, CLIP_HEIGHT, { fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    encoder.addFrame(new Uint8Array(data));
  }
  encoder.finish();

  const buffer = Buffer.from(encoder.out.data);
  const dir = await ensureRoomDir(code);
  const filename = "clip.gif";
  await writeFile(path.join(dir, filename), buffer);

  return { url: `/api/strip-image/${code}/${filename}` };
}

export { STORAGE_ROOT };
