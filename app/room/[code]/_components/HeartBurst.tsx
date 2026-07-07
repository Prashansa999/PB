"use client";

import { useEffect, useState } from "react";

interface Heart {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
  drift: number;
  emoji: string;
}

const EMOJIS = ["💛", "💗", "💕", "✨", "💫"];
const HEART_COUNT = 22;

function randomHearts(): Heart[] {
  return Array.from({ length: HEART_COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 2.2 + Math.random() * 1.4,
    size: 16 + Math.random() * 22,
    drift: (Math.random() - 0.5) * 80,
    emoji: EMOJIS[i % EMOJIS.length],
  }));
}

/** A one-shot burst of floating hearts, triggered by mounting this
 * component (parent controls that via conditional render tied to the
 * reveal moment) — not a persistent decoration. This only ever mounts
 * client-side, well after the interactive session has started, so a lazy
 * useState initializer (rather than an effect) is safe here — there's no
 * server-rendered HTML for Math.random() to mismatch against. */
export function HeartBurst() {
  const [hearts, setHearts] = useState<Heart[]>(randomHearts);

  useEffect(() => {
    const timer = setTimeout(() => setHearts([]), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {hearts.map((h) => (
        <span
          key={h.id}
          className="absolute bottom-0"
          style={{
            left: `${h.left}%`,
            fontSize: h.size,
            animation: `heart-rise ${h.duration}s ease-out ${h.delay}s forwards`,
            // Custom property read by the keyframes below for horizontal drift.
            ["--drift" as string]: `${h.drift}px`,
          }}
        >
          {h.emoji}
        </span>
      ))}
    </div>
  );
}
