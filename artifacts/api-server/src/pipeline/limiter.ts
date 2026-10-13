const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window limiter shared by every run in this process, so concurrent runs together stay under
 * TinyFish's per-key limits instead of each run assuming it has the whole quota.
 */
export class WindowLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly perWindow: number,
    private readonly windowMs = 60_000,
  ) {}

  async take(units = 1): Promise<void> {
    const need = Math.min(Math.max(1, units), this.perWindow);
    for (;;) {
      const now = Date.now();
      while (this.stamps.length > 0 && now - (this.stamps[0] ?? 0) >= this.windowMs) this.stamps.shift();
      if (this.stamps.length + need <= this.perWindow) {
        for (let i = 0; i < need; i++) this.stamps.push(now);
        return;
      }
      const oldest = this.stamps[this.stamps.length + need - this.perWindow - 1] ?? now;
      await sleep(Math.max(50, this.windowMs - (now - oldest) + 25));
    }
  }
}
