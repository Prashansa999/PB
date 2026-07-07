"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/shared/roomCode";

const STEPS = [
  {
    title: "Open a room",
    body: "Start a session and allow camera access — nothing to download, it runs right in your browser.",
  },
  {
    title: "Send the code",
    body: "A short room code appears. Text it over — they'll be there in a tap.",
  },
  {
    title: "Countdown fires the shot",
    body: "A shared countdown fires the shot on both screens at once, so every frame of the strip holds both of you.",
  },
];

const FAQS = [
  {
    q: "Do I need an app?",
    a: "No. S P Photobooth runs entirely in your phone or laptop browser. Allow camera access and you're in.",
  },
  {
    q: "Does my partner need an account?",
    a: "No account, no login, for either of you. Whoever opens the room gets a code — your partner just enters it.",
  },
  {
    q: "Is it really free?",
    a: "Yes — starting a session, taking your strip, and downloading the PNG or clip is completely free.",
  },
  {
    q: "What happens to our photos?",
    a: "Your captured frames stay tied to your private room code and aren't shared publicly. Strips remain downloadable for a limited time after your session.",
  },
  {
    q: "When do we pick a filter?",
    a: "After you see the photos, not before — so you're choosing based on how they actually turned out, together. You can keep trying different ones (and different layouts) for as long as you want.",
  },
];

export default function Home() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  async function startSession() {
    setStarting(true);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const { code } = await res.json();
      sessionStorage.setItem(`spb-role-${code}`, "host");
      router.push(`/room/${code}`);
    } catch {
      setStarting(false);
    }
  }

  function joinSession(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) {
      setJoinError("That doesn't look like a valid 5-character code.");
      return;
    }
    router.push(`/room/${code}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center">
      <main className="w-full max-w-3xl px-6 py-16 sm:py-24">
        <div className="text-center">
          <p className="mb-4 inline-block rounded-full border border-border bg-card px-4 py-1 text-sm font-medium text-accent-strong">
            S P Photobooth
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl font-[family-name:var(--font-display)]">
            Online Photobooth for Long Distance Couples
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed opacity-80">
            Both of you appear in one photo strip, captured at the same second —
            no app, no download, just a room code.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              onClick={startSession}
              disabled={starting}
              className="rounded-full bg-accent px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110 disabled:opacity-60"
            >
              {starting ? "Opening your room…" : "Start a photobooth session"}
            </button>
            <p className="text-sm opacity-60">
              Runs right in your browser, phone or laptop. Allow camera access and you&rsquo;re in.
            </p>
          </div>

          <form onSubmit={joinSession} className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-2">
            <p className="text-sm opacity-60">Have a code from your partner?</p>
            <div className="flex w-full gap-2">
              <input
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  setJoinError(null);
                }}
                placeholder="Room code"
                maxLength={5}
                className="w-full rounded-full border border-border bg-card px-5 py-3 text-center uppercase tracking-[0.3em] outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="shrink-0 rounded-full border border-border px-5 py-3 font-medium transition hover:border-accent hover:text-accent"
              >
                Join
              </button>
            </div>
            {joinError && <p className="text-sm text-red-500">{joinError}</p>}
          </form>
        </div>

        <section className="mt-24 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-strong">
                {i + 1}
              </div>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm opacity-75">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid gap-6 p-8 sm:grid-cols-2 sm:items-center">
            <div>
              <h2 className="text-2xl font-bold font-[family-name:var(--font-display)]">
                Then make it yours.
              </h2>
              <p className="mt-3 text-sm leading-relaxed opacity-80">
                Once you see the photos, pick a filter, arrange them as a strip, a
                scattered collage, or a fanned-out stack, and write a little note
                together — all synced live, so you&rsquo;re deciding together, not guessing.
              </p>
            </div>
            <div className="flex justify-center gap-3">
              {[-6, 4, -3].map((deg, i) => (
                <div
                  key={i}
                  className="flex h-28 w-20 flex-col gap-1 rounded-lg border-4 border-white bg-gradient-to-b from-accent-soft to-white p-1 shadow-xl"
                  style={{ transform: `rotate(${deg}deg)` }}
                >
                  <div className="flex-1 rounded bg-accent/20" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-center text-2xl font-bold font-[family-name:var(--font-display)]">
            Questions
          </h2>
          <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
            {FAQS.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="cursor-pointer list-none font-medium marker:content-none">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm opacity-75">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="mt-auto w-full border-t border-border py-8 text-center text-sm opacity-60">
        S P Photobooth — a realtime thing you do at the same second, not messages in parallel.
      </footer>
    </div>
  );
}
