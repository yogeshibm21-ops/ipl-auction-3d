export const AUCTION_PACING = Object.freeze({
  Relaxed: Object.freeze({ aiDelay: 1200, openWindow: 14000, goingOnce: 3600, goingTwice: 2600, finalWindow: 2200, resultWindow: 1800, rtmWindow: 6000 }),
  Standard: Object.freeze({ aiDelay: 800, openWindow: 9000, goingOnce: 2500, goingTwice: 1800, finalWindow: 1500, resultWindow: 1300, rtmWindow: 5000 }),
  Fast: Object.freeze({ aiDelay: 500, openWindow: 5000, goingOnce: 1600, goingTwice: 1100, finalWindow: 1000, resultWindow: 900, rtmWindow: 3500 })
});

export function normalizeFinalCallDuration(value = 7) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 7;
  return Math.max(5, Math.min(10, Math.round(seconds)));
}

export function finalCallStageDurations(value = 7) {
  const totalMs = normalizeFinalCallDuration(value) * 1000;
  return {
    toGoingTwiceMs: 2000,
    toFinalCallMs: 2000,
    finalCallMs: totalMs - 4000,
    totalMs
  };
}

export class AuctionClock {
  constructor({ pacing = "Relaxed", timers = globalThis } = {}) {
    this.pacing = AUCTION_PACING[pacing] ? pacing : "Relaxed";
    this.timers = timers;
    this.tasks = new Map();
    this.generation = 0;
    this.paused = false;
    this.nextId = 1;
  }

  delay(name) {
    return AUCTION_PACING[this.pacing][name];
  }

  schedule(callback, milliseconds, generation = this.generation) {
    const task = { callback, generation, remaining: Math.max(0, milliseconds), handle: null, startedAt: null };
    const handle = this.nextId++;
    this.tasks.set(handle, task);
    if (!this.paused) this.arm(handle, task);
    return handle;
  }

  arm(id, task) {
    task.startedAt = Date.now();
    task.handle = this.timers.setTimeout(() => {
      this.tasks.delete(id);
      if (task.generation === this.generation) task.callback();
    }, task.remaining);
  }

  pause() {
    if (this.paused) return false;
    this.paused = true;
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.handle !== null) {
        task.remaining = Math.max(0, task.remaining - (now - task.startedAt));
        this.timers.clearTimeout(task.handle);
        task.handle = null;
        task.startedAt = null;
      }
    }
    return true;
  }

  resume() {
    if (!this.paused) return false;
    this.paused = false;
    for (const [id, task] of this.tasks) this.arm(id, task);
    return true;
  }

  remaining() {
    if (!this.tasks.size) return null;
    const task = this.tasks.values().next().value;
    if (this.paused || task.startedAt === null) return task.remaining;
    return Math.max(0, task.remaining - (Date.now() - task.startedAt));
  }

  get pendingCount() {
    return this.tasks.size;
  }

  reset() {
    this.generation += 1;
    for (const task of this.tasks.values()) {
      if (task.handle !== null) this.timers.clearTimeout(task.handle);
    }
    this.tasks.clear();
    return this.generation;
  }

  dispose() {
    this.reset();
  }
}
