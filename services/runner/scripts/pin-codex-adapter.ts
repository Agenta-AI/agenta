/**
 * Bake-time pin for the Codex ACP adapter (decision D-005). The `sandbox-agent` npm
 * package ships no `bin` entry (its CLI lives in the transitive optional dependency
 * `@sandbox-agent/cli`), so no `node_modules/.bin/sandbox-agent` exists to call from a
 * Dockerfile. This script resolves the daemon binary through the runner's own
 * resolution (daemon.ts, the same path used at runtime) and forwards argv verbatim,
 * e.g. `tsx scripts/pin-codex-adapter.ts install-agent codex --agent-process-version 1.7.0 -n`.
 */
import { spawnSync } from "node:child_process";

import { resolveDaemonBinary } from "../src/engines/sandbox_agent/daemon.ts";

const bin = resolveDaemonBinary();
if (!bin) {
  console.error(
    "pin-codex-adapter: could not resolve the sandbox-agent daemon binary",
  );
  process.exit(1);
}
const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
