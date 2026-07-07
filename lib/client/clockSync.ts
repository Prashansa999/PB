// NTP-style clock offset estimation over the room's WebSocket connection.
// See build-prompt §5.2: the server never tells a client "count down from
// 3s from now" — it hands out an absolute server timestamp, and each client
// converts that into its own local schedule using the offset computed here.

export interface ClockSyncSample {
  roundTripMs: number;
  offsetMs: number; // add this to a local Date.now() to estimate server time
}

export interface ClockSyncResult {
  offsetMs: number;
  roundTripMs: number;
}

type PingSender = (id: string, t0: number) => void;

export class ClockSync {
  private pending = new Map<string, { t0: number; resolve: (s: ClockSyncSample) => void }>();
  private samples: ClockSyncSample[] = [];
  private sendPing: PingSender;

  constructor(sendPing: PingSender) {
    this.sendPing = sendPing;
  }

  /** Call this when a `clock-sync-pong` message arrives. */
  handlePong(id: string, t0: number, t1: number, t2: number): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);

    const t3 = Date.now();
    const roundTripMs = t3 - t0 - (t2 - t1);
    const offsetMs = (t1 - t0 + (t2 - t3)) / 2;
    const sample = { roundTripMs: Math.max(0, roundTripMs), offsetMs };
    this.samples.push(sample);
    entry.resolve(sample);
  }

  private pingOnce(): Promise<ClockSyncSample> {
    const id = Math.random().toString(36).slice(2);
    const t0 = Date.now();
    return new Promise((resolve) => {
      this.pending.set(id, { t0, resolve });
      this.sendPing(id, t0);
    });
  }

  /** Runs `count` round trips and returns the median offset/RTT, which is
   * far less noisy than trusting a single sample. */
  async measure(count = 5): Promise<ClockSyncResult> {
    const results: ClockSyncSample[] = [];
    for (let i = 0; i < count; i++) {
      results.push(await this.pingOnce());
      // Small gap so samples aren't all bunched into one burst.
      await new Promise((r) => setTimeout(r, 60));
    }
    const offsets = results.map((r) => r.offsetMs).sort((a, b) => a - b);
    const roundTrips = results.map((r) => r.roundTripMs).sort((a, b) => a - b);
    const mid = Math.floor(results.length / 2);
    return { offsetMs: offsets[mid], roundTripMs: roundTrips[mid] };
  }
}
