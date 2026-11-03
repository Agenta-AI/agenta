"use strict";

// The agent waiting for the person. A reason stays open across `wait` calls (each call blocks for
// one slice) until the person clicks "I'm done" or the total time for that reason runs out.
//
//   open -> done      on `done()`; pending calls resolve "done" now, and the next `wait` with the
//                     reason answers "done" too, so a click between two calls is not lost
//   open -> expired   when `totalMs` passed since the first `wait` with the reason
//   done | expired    answered once by the next `wait` with the reason, then forgotten
//   a call -> "still" when its slice ends first; the reason stays open

function createWaits({ sliceMs, totalMs, now = Date.now, onChange = () => {} }) {
  const reasons = new Map(); // reason -> { startedAt, state: "open" | "done" | "expired", timer }
  let pending = []; // { reason, resolve, timer }

  function settle(reason, state) {
    const entry = reasons.get(reason);
    if (!entry || entry.state !== "open") return;
    clearTimeout(entry.timer);
    entry.state = state;
    const resolved = pending.filter((w) => w.reason === reason);
    pending = pending.filter((w) => w.reason !== reason);
    for (const waiter of resolved) {
      clearTimeout(waiter.timer);
      reasons.delete(reason);
      waiter.resolve(state);
    }
    onChange();
  }

  function open(reason) {
    let entry = reasons.get(reason);
    if (!entry) {
      entry = { startedAt: now(), state: "open" };
      entry.timer = setTimeout(() => settle(reason, "expired"), totalMs);
      entry.timer.unref?.();
      reasons.set(reason, entry);
      onChange();
    }
    return entry;
  }

  return {
    wait(reason) {
      const entry = open(reason);
      if (entry.state !== "open") {
        reasons.delete(reason);
        return Promise.resolve(entry.state);
      }
      const left = entry.startedAt + totalMs - now();
      if (left <= 0) {
        settle(reason, "expired");
        reasons.delete(reason);
        return Promise.resolve("expired");
      }
      return new Promise((resolve) => {
        const waiter = { reason, resolve };
        waiter.timer = setTimeout(() => {
          pending = pending.filter((w) => w !== waiter);
          resolve("still");
        }, Math.min(sliceMs, left));
        pending.push(waiter);
      });
    },
    done() {
      for (const [reason, entry] of reasons) if (entry.state === "open") settle(reason, "done");
    },
    // The newest reason still open, for the live view's banner.
    reason() {
      let last = "";
      for (const [reason, entry] of reasons) if (entry.state === "open") last = reason;
      return last;
    },
    pendingCount: () => pending.length,
    active() {
      return pending.length > 0 || this.reason() !== "";
    },
  };
}

module.exports = { createWaits };
