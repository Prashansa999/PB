"use client";

import { CAPTION_MAX_LENGTH } from "@/lib/shared/protocol";

export function CaptionField({
  caption,
  onChange,
}: {
  caption: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-5">
      <label className="text-sm font-medium opacity-70" htmlFor="strip-caption">
        Write a little note together — it&rsquo;ll be on the last photo 🩷
      </label>
      <input
        id="strip-caption"
        type="text"
        value={caption}
        onChange={(e) => onChange(e.target.value.slice(0, CAPTION_MAX_LENGTH))}
        placeholder="Est. today · miles apart, same second"
        maxLength={CAPTION_MAX_LENGTH}
        className="mt-2 w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-accent"
      />
      <p className="mt-1 text-right text-xs opacity-40">
        {caption.length}/{CAPTION_MAX_LENGTH}
      </p>
    </div>
  );
}
