/**
 * A model call Pi is retrying is progress for the run limits, and nothing the person reads.
 *
 * The runner's pi-acp patch reports Pi's `auto_retry_start` and `auto_retry_end` as a
 * `session_info_update`. Without it, a slow provider that Pi retries looked like a stuck harness,
 * and the first-response limit ended the turn and ran the prompt again.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

function tracer() {
  let progress = 0;
  const run = createSandboxAgentOtel({
    harness: "pi_core",
    model: "openai/x",
    emit: () => {},
    onProgress: () => {
      progress += 1;
    },
  });
  run.start({ prompt: "hi" });
  return { run, progress: () => progress };
}

describe("a Pi retry", () => {
  it("counts as progress and records no event", () => {
    const { run, progress } = tracer();

    run.handleUpdate({
      sessionUpdate: "session_info_update",
      _meta: { piAcp: { retrying: true } },
    });
    run.handleUpdate({
      sessionUpdate: "session_info_update",
      _meta: { piAcp: { retrying: false } },
    });

    assert.equal(progress(), 2);
    assert.deepEqual(run.events(), []);
  });

  it("is told apart from the queue state pi-acp also reports", () => {
    const { run, progress } = tracer();

    run.handleUpdate({
      sessionUpdate: "session_info_update",
      _meta: { piAcp: { queueDepth: 0, running: true } },
    });

    assert.equal(progress(), 0);
  });
});
