import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { STORAGE_ROOT } from "@/lib/server/compositor";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".gif": "image/gif",
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;

  // Reject anything that isn't exactly [ROOM_CODE, filename] to prevent
  // path traversal outside the strips storage directory.
  if (segments.length !== 2 || segments.some((s) => s.includes("..") || s.includes("/"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [code, filename] = segments;
  const ext = path.extname(filename);
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filePath = path.join(STORAGE_ROOT, code.toUpperCase(), filename);
  if (!filePath.startsWith(STORAGE_ROOT)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const data = await readFile(filePath);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
