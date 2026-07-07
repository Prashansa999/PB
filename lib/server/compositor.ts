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
const TILE_WIDTH = 480;
const TILE_HEIGHT = 480;
const GUTTER = 8;
const BORDER = 16;

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

async function centerCropToTile(input: Buffer, filterId: FilterId): Promise<Buffer> {
  const cropped = await sharp(input)
    .rotate() // respect EXIF orientation from mobile cameras
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "cover", position: "attention" })
    .toBuffer();
  // Filter is applied after the crop so grain/vignette generation always
  // works against the same fixed tile size, regardless of source aspect
  // ratio — see lib/server/filters.ts for what "none" vs. a real filter
  // does here.
  return applyFilter(cropped, filterId);
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
  filterId: FilterId
): Promise<{ buffer: Buffer; url: string }> {
  const [hostTile, guestTile] = await Promise.all([
    centerCropToTile(hostFrame, filterId),
    centerCropToTile(guestFrame, filterId),
  ]);

  const width = TILE_WIDTH * 2 + GUTTER + BORDER * 2;
  const height = TILE_HEIGHT + BORDER * 2;

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 248, b: 240 },
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

const POLAROID_SIDE_MARGIN = 22;
const POLAROID_TOP_MARGIN = 22;
const POLAROID_BOTTOM_MARGIN = 88; // the classic instant-photo caption strip
const POLAROID_CORNER_RADIUS = 10;
const POLAROID_GAP = 34;
const CANVAS_PADDING = 60;
const HEADER_HEIGHT = 76;
const SHADOW_OFFSET = 7;

// Per-layout, deterministic (not random) tilt angles and placement
// constants — deterministic so a given session's arrangement is stable if
// the strip is ever regenerated (filter change, caption edit).
const ROTATIONS_DEG: Record<PolaroidLayout, number[]> = {
  strip: [-4, 3, -3.5, 4.5],
  collage: [-6, 4, -5, 6],
  stack: [-11, 7, -8, 12],
};
const STRIP_DRIFT_PX = [-16, 12, -10, 16];
const STACK_FAN_PX: { dx: number; dy: number }[] = [
  { dx: -34, dy: 0 },
  { dx: 16, dy: 14 },
  { dx: -14, dy: 30 },
  { dx: 32, dy: 40 },
];

async function buildWhitePolaroidCard(
  photo: Buffer,
  captionText: string | null
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { width: photoWidth = 0, height: photoHeight = 0 } = await sharp(photo).metadata();
  const cardWidth = photoWidth + POLAROID_SIDE_MARGIN * 2;
  const cardHeight = photoHeight + POLAROID_TOP_MARGIN + POLAROID_BOTTOM_MARGIN;

  const overlays: { input: Buffer; left: number; top: number }[] = [
    { input: photo, left: POLAROID_SIDE_MARGIN, top: POLAROID_TOP_MARGIN },
  ];

  if (captionText) {
    const escaped = captionText.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const captionSvg = Buffer.from(
      `<svg width="${cardWidth}" height="${POLAROID_BOTTOM_MARGIN}" xmlns="http://www.w3.org/2000/svg">
        <text x="50%" y="58%" text-anchor="middle" dominant-baseline="middle"
          font-family="'Segoe Script','Bradley Hand','Comic Sans MS',cursive" font-size="30"
          fill="#4a3626">${escaped}</text>
      </svg>`
    );
    overlays.push({ input: captionSvg, left: 0, top: photoHeight + POLAROID_TOP_MARGIN });
  }

  let card = await sharp({
    create: { width: cardWidth, height: cardHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
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
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}"
      rx="${POLAROID_CORNER_RADIUS}" ry="${POLAROID_CORNER_RADIUS}" fill="black" fill-opacity="0.32"/></svg>`
  );
  return sharp(await sharp(svg).png().toBuffer())
    .blur(9)
    .png()
    .toBuffer();
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

  const cards = await Promise.all(
    roundBuffers.map((buf, i) =>
      buildWhitePolaroidCard(buf, i === roundBuffers.length - 1 ? caption || null : null)
    )
  );
  const rotated = await Promise.all(
    cards.map((card, i) => rotateWithTransparentPadding(card.buffer, rotations[i % rotations.length]))
  );
  const shadows = await Promise.all(rotated.map((r) => buildCardShadow(r.width, r.height)));

  const { width, height, placements } = computeLayout(layout, rotated);

  const headerSvg = Buffer.from(
    `<svg width="${width}" height="${HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="65%" text-anchor="middle" font-family="Georgia, serif"
        font-size="34" font-weight="700" fill="#c2410c">S P Photobooth 🩷</text>
    </svg>`
  );

  const composites: { input: Buffer; left: number; top: number }[] = [
    { input: headerSvg, left: 0, top: 0 },
  ];
  for (let i = 0; i < rotated.length; i++) {
    const { left, top } = placements[i];
    // Shadow immediately followed by its own card, per card — not all
    // shadows then all cards — so overlapping cards (collage/stack) layer
    // correctly instead of every shadow sitting under every card.
    composites.push({ input: shadows[i], left: left + SHADOW_OFFSET, top: top + SHADOW_OFFSET });
    composites.push({ input: rotated[i].buffer, left, top });
  }

  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 248, b: 240 } },
  })
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
