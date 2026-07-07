import sharp from "sharp";
import GIFEncoder from "gif-encoder-2";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

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

async function centerCropToTile(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate() // respect EXIF orientation from mobile cameras
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "cover", position: "attention" })
    .toBuffer();
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
  guestFrame: Buffer
): Promise<{ buffer: Buffer; url: string }> {
  const [hostTile, guestTile] = await Promise.all([
    centerCropToTile(hostFrame),
    centerCropToTile(guestFrame),
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

/**
 * Stacks every round's composite vertically into the final strip, the
 * classic photobooth output.
 */
export async function assembleFinalStrip(
  code: string,
  roundBuffers: Buffer[]
): Promise<{ url: string }> {
  const metas = await Promise.all(roundBuffers.map((b) => sharp(b).metadata()));
  const width = Math.max(...metas.map((m) => m.width ?? 0));
  const stripGutter = 6;
  const headerHeight = 64;
  const footerHeight = 40;
  const totalHeight =
    headerHeight +
    footerHeight +
    metas.reduce((sum, m) => sum + (m.height ?? 0), 0) +
    stripGutter * (roundBuffers.length - 1);

  let y = headerHeight;
  const composites: { input: Buffer; left: number; top: number }[] = roundBuffers.map((buf, i) => {
    const entry = { input: buf, left: 0, top: y };
    y += (metas[i].height ?? 0) + stripGutter;
    return entry;
  });

  const dateLabel = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const headerSvg = Buffer.from(
    `<svg width="${width}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="60%" text-anchor="middle" font-family="Georgia, serif"
        font-size="32" font-weight="700" fill="#c2410c">S P Photobooth</text>
    </svg>`
  );
  const footerSvg = Buffer.from(
    `<svg width="${width}" height="${footerHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="65%" text-anchor="middle" font-family="Georgia, serif"
        font-size="18" fill="#9a3412">${dateLabel} · captured together, at the same second</text>
    </svg>`
  );
  composites.push(
    { input: headerSvg, left: 0, top: 0 },
    { input: footerSvg, left: 0, top: totalHeight - footerHeight }
  );

  const strip = sharp({
    create: {
      width,
      height: totalHeight,
      channels: 3,
      background: { r: 255, g: 248, b: 240 },
    },
  }).composite(composites);

  const buffer = await strip.png().toBuffer();
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
