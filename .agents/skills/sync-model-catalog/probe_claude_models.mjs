// List the models a Claude Agent SDK build offers, with the local Claude login.
//
// Usage: node probe_claude_models.mjs <path to claude-agent-sdk/sdk.mjs>
//
// The runner pins @agentclientprotocol/claude-agent-acp, which bundles its own
// claude-agent-sdk (and so its own Claude Code build). Point this script at that copy
// to see what the pinned harness offers, or at a newer copy to see what a bump adds:
//
//   ls -d services/runner/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@*/node_modules/@anthropic-ai/claude-agent-sdk
//
// The picker sends the ACP adapter's config option values, which can differ from the
// `value` printed here (for example `claude-fable-5-2` instead of `fable`). Use this
// output to see WHICH models a build offers; read the adapter for the exact values.
const sdkPath = process.argv[2];
if (!sdkPath) {
  console.error("usage: node probe_claude_models.mjs <path to sdk.mjs>");
  process.exit(2);
}
const { query } = await import(sdkPath);

async function* idle() {
  await new Promise(() => {});
}

const q = query({ prompt: idle(), options: { cwd: process.env.TMPDIR || "/tmp" } });
const timer = setTimeout(() => {
  console.error("timed out waiting for supportedModels()");
  process.exit(1);
}, 90_000);
const models = await q.supportedModels();
clearTimeout(timer);
for (const m of models) {
  console.log(`${m.value}\t${m.displayName}\t${m.description}`);
}
process.exit(0);
