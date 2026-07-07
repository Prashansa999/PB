"use client";

import { useEffect, useState } from "react";

export function CountdownOverlay({
  tFire,
  tCountdownVisibleAt,
}: {
  tFire: number;
  tCountdownVisibleAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let raf: number;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const beforeVisible = now < tCountdownVisibleAt;
  const secondsLeft = Math.max(0, Math.ceil((tFire - now) / 1000));

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      {beforeVisible ? (
        <p className="rounded-full bg-white/90 px-6 py-3 text-lg font-medium text-accent-strong">
          Stabilizing connection…
        </p>
      ) : (
        <span
          key={secondsLeft}
          className="countdown-beat text-9xl font-bold text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
        >
          {secondsLeft > 0 ? secondsLeft : "📸"}
        </span>
      )}
    </div>
  );
}
