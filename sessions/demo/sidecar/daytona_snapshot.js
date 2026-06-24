// Builds the Daytona snapshot (template-equivalent) used by provider-daytona.js:
// sandbox-agent + claude + codex + opencode + pi + geesefs, all baked in. Mirrors the
// E2B template (e2b-template/e2b.Dockerfile) — Daytona sandboxes are x86_64, so the
// linux-x64/amd64 binaries are correct. Run once:  node daytona_snapshot.js
//
// Idempotent: if the snapshot already exists and --force isn't passed, it's a no-op.
import { Daytona, Image } from "@daytonaio/sdk";

const SNAPSHOT = process.env.DAYTONA_SNAPSHOT || "agenta-sandbox-agent";
const SA = "/root/.local/share/sandbox-agent/bin";
const GEESEFS = "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64";

// base64 launchers (identical to the E2B template) — exec the per-agent ACP adapter.
const L_CLAUDE = "IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jbGF1ZGUvbm9kZV9tb2R1bGVzLy5iaW4vY2xhdWRlLWFnZW50LWFjcCAiJEAiCg==";
const L_CODEX = "IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jb2RleC9ub2RlX21vZHVsZXMvLmJpbi9jb2RleC1hY3AgIiRAIgo=";
const L_OPENCODE = "IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9vcGVuY29kZS9vcGVuY29kZSBhY3AgIiRAIgo=";
const L_PI = "IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9waS9ub2RlX21vZHVsZXMvLmJpbi9waS1hY3AgIiRAIgo=";

const image = Image.base("debian:12-slim")
  .runCommands(
    "apt-get update && apt-get install -y --no-install-recommends bash ca-certificates curl git fuse procps sudo jq && rm -rf /var/lib/apt/lists/*",
    // node 22 (pi needs >=22.19)
    "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && node --version",
    "echo user_allow_other >> /etc/fuse.conf",
    // rivet sandbox-agent
    "curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh && (command -v sandbox-agent || cp \"$(find / -name sandbox-agent -type f 2>/dev/null | head -1)\" /usr/local/bin/sandbox-agent) && sandbox-agent --version",
    // claude: native binary + adapter + launcher
    `mkdir -p ${SA} && CLAUDE_VER=$(curl -fsSL https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/stable) && curl -fsSL -o ${SA}/claude "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/$CLAUDE_VER/linux-x64/claude" && chmod +x ${SA}/claude`,
    `mkdir -p ${SA}/agent_processes/claude && cd ${SA}/agent_processes/claude && npm install @agentclientprotocol/claude-agent-acp@^0.50.0 && echo '${L_CLAUDE}' | base64 -d > ${SA}/agent_processes/claude-acp && chmod +x ${SA}/agent_processes/claude-acp`,
    // codex: native binary + adapter + launcher
    `curl -fsSL -o /tmp/codex.tgz "https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-musl.tar.gz" && tar -xzf /tmp/codex.tgz -C /tmp && mv "$(find /tmp -name 'codex-x86_64-unknown-linux-musl' -type f | head -1)" ${SA}/codex && chmod +x ${SA}/codex && rm -f /tmp/codex.tgz`,
    `mkdir -p ${SA}/agent_processes/codex && cd ${SA}/agent_processes/codex && npm install @agentclientprotocol/codex-acp@^1.0.0 && echo '${L_CODEX}' | base64 -d > ${SA}/agent_processes/codex-acp && chmod +x ${SA}/agent_processes/codex-acp`,
    // opencode: native x64 binary + launcher
    `mkdir -p ${SA}/agent_processes/opencode && curl -fsSL -o /tmp/oc.tgz "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz" && rm -rf /tmp/ocx && mkdir -p /tmp/ocx && tar -xzf /tmp/oc.tgz -C /tmp/ocx && install -m755 "$(find /tmp/ocx -name opencode -type f | head -1)" ${SA}/agent_processes/opencode/opencode && install -m755 "$(find /tmp/ocx -name opencode -type f | head -1)" ${SA}/opencode && rm -rf /tmp/oc.tgz /tmp/ocx && echo '${L_OPENCODE}' | base64 -d > ${SA}/agent_processes/opencode-acp && chmod +x ${SA}/agent_processes/opencode-acp`,
    // pi: adapter + real CLI + launcher
    `mkdir -p ${SA}/agent_processes/pi && cd ${SA}/agent_processes/pi && npm install pi-acp@^0.0.31 && npm install -g @earendil-works/pi-coding-agent@0.80.2 && echo '${L_PI}' | base64 -d > ${SA}/agent_processes/pi-acp && chmod +x ${SA}/agent_processes/pi-acp`,
    // geesefs
    `curl -fsSL -o /usr/local/bin/geesefs ${GEESEFS} && chmod +x /usr/local/bin/geesefs`,
  )
  .entrypoint(["sleep", "infinity"]);

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const force = process.argv.includes("--force");

const existing = await daytona.snapshot.get(SNAPSHOT).catch(() => null);
if (existing && !force) {
  console.log(`snapshot '${SNAPSHOT}' already exists (state=${existing.state}); use --force to rebuild`);
  process.exit(0);
}
if (existing && force) {
  console.log(`deleting existing '${SNAPSHOT}'…`);
  await daytona.snapshot.delete(existing).catch((e) => console.warn("delete:", e.message));
}

console.log(`building snapshot '${SNAPSHOT}' (this takes a few minutes)…`);
await daytona.snapshot.create(
  { name: SNAPSHOT, image, resources: { cpu: 2, memory: 4, disk: 8 } },
  { onLogs: (l) => process.stdout.write(l), timeout: 1200 },
);
console.log(`\nsnapshot '${SNAPSHOT}' ready.`);
