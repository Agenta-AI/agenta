"use strict";

// The agent waiting for the person. One agent drives one browser, so there is one wait at a time:
// it stays open across `wait` calls (each call blocks for one slice) until the person clicks
// "I'm done" or its total time runs out. Models reword their reason between calls, so a new
// reason only updates the ask the person sees; it neither opens a second wait nor resets the time.
//
//   open -> done      on `done()`; pending calls resolve "done" now, else the next `wait` does,
//                     so a click between two calls is not lost
//   open -> expired   when `totalMs` passed since the wait opened
//   done | expired    answered once by the next `wait` within `answerMs`, then forgotten, so
//                     an answer left over from an ended turn cannot answer a new one
//   a call -> "still" when its slice ends first; the wait stays open
//   no call for `graceMs` after a slice or a done: the turn ended, so the wait is forgotten

function createWaits({
  sliceMs,
  totalMs,
  graceMs = 120_000,
  answerMs = 30_000,
  now = Date.now,
  onChange = () => {},
}) {
  let slot = null; // { reason, startedAt, state: "open" | "done" | "expired", timer, grace }
  let pending = []; // { resolve, timer }

  function forget() {
    if (!slot) return;
    clearTimeout(slot.timer);
    clearTimeout(slot.grace);
    slot = null;
    onChange();
  }

  function forgetLater(ms = graceMs) {
    if (!slot) return;
    clearTimeout(slot.grace);
    slot.grace = setTimeout(forget, ms);
    slot.grace.unref?.();
  }

  function settle(state) {
    if (!slot || slot.state !== "open") return;
    clearTimeout(slot.timer);
    slot.state = state;
    const resolved = pending;
    pending = [];
    for (const waiter of resolved) {
      clearTimeout(waiter.timer);
      waiter.resolve(state);
    }
    if (resolved.length) forget();
    else {
      forgetLater(answerMs);
      onChange();
    }
  }

  return {
    wait(reason) {
      if (slot && slot.state !== "open") {
        const state = slot.state;
        forget();
        return Promise.resolve(state);
      }
      if (!slot) {
        slot = { reason, startedAt: now(), state: "open" };
        slot.timer = setTimeout(() => settle("expired"), totalMs);
        slot.timer.unref?.();
        onChange();
      } else if (slot.reason !== reason) {
        slot.reason = reason;
        onChange();
      }
      clearTimeout(slot.grace);
      const end = slot.startedAt + totalMs;
      if (now() >= end) {
        settle("expired");
        forget();
        return Promise.resolve("expired");
      }
      return new Promise((resolve) => {
        const waiter = { resolve };
        waiter.timer = setTimeout(() => {
          pending = pending.filter((w) => w !== waiter);
          // The wait was forgotten under this call (a grace shorter than a slice): it is over.
          if (!slot) return resolve("expired");
          // The last slice ends with the total time; it must not race the expiry into "still".
          if (now() >= end) {
            pending.push(waiter);
            return settle("expired");
          }
          forgetLater();
          resolve("still");
        }, Math.min(sliceMs, end - now()));
        pending.push(waiter);
      });
    },
    done() {
      settle("done");
    },
    // The open wait's reason, for the live view's banner and `/health`.
    reason() {
      return slot?.state === "open" ? slot.reason : "";
    },
    active() {
      return pending.length > 0 || this.reason() !== "";
    },
  };
}

module.exports = { createWaits };
