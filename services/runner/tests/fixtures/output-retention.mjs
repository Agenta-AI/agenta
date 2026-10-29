// Runs in a small, isolated heap. No model, platform service or credential is used.
import assert from "node:assert/strict";
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

const kind = process.argv[2] ?? "agent_message_chunk";
let breaches = 0;
let delivered = 0;
const run = createSandboxAgentOtel({
  emitSpans: false,
  emit: () => {
    delivered++;
  },
  onOutputLimit: () => {
    breaches++;
  },
});
run.start({ prompt: "synthetic output flood" });
const part = "z".repeat(4096);
global.gc();
const startHeap = process.memoryUsage().heapUsed;
for (let i = 0; i < 25_000; i++) {
  const update = {
    sessionUpdate: kind,
    content: { type: "text", text: `${i}:${part}` },
  };
  if (run.admitUpdate(update)) run.handleUpdate(update, true);
}
assert.equal(breaches, 1);
run.emitEvent({
  type: "error",
  code: "output_limit_exceeded",
  message: "Synthetic output limit",
});
run.finish("error");
assert.equal(run.events().filter((event) => event.type === "done").length, 1);
global.gc();
const retainedGrowth = process.memoryUsage().heapUsed - startHeap;
assert.ok(
  retainedGrowth < 16 * 1024 * 1024,
  `retained growth: ${retainedGrowth}`,
);
const good = createSandboxAgentOtel({ emitSpans: false });
good.handleUpdate({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "healthy second turn" },
});
assert.equal(good.finish(), "healthy second turn");
console.log(
  JSON.stringify({
    kind,
    updatesOffered: 25_000,
    approximateOfferedBytes: 25_000 * 4096,
    breaches,
    delivered,
    retainedGrowth,
    healthySecondTurn: true,
  }),
);
