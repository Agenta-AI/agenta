# E2B baked template: sandbox-agent daemon + Pi, Codex, OpenCode, Claude harnesses.
# Build: npx @e2b/cli template create agenta-sandbox-agent -d e2b.Dockerfile
FROM e2bdev/code-interpreter:latest

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git procps \
    && rm -rf /var/lib/apt/lists/*

# node 22 — base ships node 20; pi-acp requires >=22.19
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && node --version

# rivet sandbox-agent daemon (install-agent hangs in the E2B builder; replicate manually)
RUN curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh \
    && sandbox-agent --version

# pi-acp adapter; versions match services/runner/package.json pins
# ENV does not persist across RUN layers in the E2B builder — paths are hardcoded
# launcher written via base64 -d because printf '\n' is mangled in the builder
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/pi \
    && cd /root/.local/share/sandbox-agent/bin/agent_processes/pi \
    && npm install pi-acp@0.0.29
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.79.4 \
    && pi --version || true
RUN echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9waS9ub2RlX21vZHVsZXMvLmJpbi9waS1hY3AgIiRAIgo=' \
      | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/pi-acp \
      && chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/pi-acp

# ---------------------------------------------------------------------------
# codex — the daemon's own registry pins codex-acp@0.1.0 (ancient); we pin a current release
# instead, same discipline as the pi-acp pin above (0.0.29 vs the daemon's registry 0.0.23).
# Two parts, replicating what `sandbox-agent install-agent codex` does: the codex-acp ACP
# adapter (npm, installed into its own `codex-adapter` dir so it never collides with the
# `codex` launcher filename below) that speaks ACP to the daemon, and the native `codex` CLI
# binary (Rust, GitHub release) that the adapter shells out to. Pin-drift risk: codex-acp and
# the codex CLI version independently; bump both together and re-smoke-test on install-agent bump.
# `@zed-industries/codex-acp` is deprecated in favor of `@agentclientprotocol/codex-acp`; kept
# on the old scope here to match what THIS daemon version's (`sandbox-agent` 0.4.2) own
# registry and adapters.json still expect — re-pin both together on the next daemon bump.
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/codex-adapter \
    && cd /root/.local/share/sandbox-agent/bin/agent_processes/codex-adapter \
    && npm install --ignore-scripts @zed-industries/codex-acp@0.16.0
RUN curl -fsSL -o /tmp/codex.tar.gz \
      https://github.com/openai/codex/releases/download/rust-v0.142.5/codex-x86_64-unknown-linux-musl.tar.gz \
    && tar -xzf /tmp/codex.tar.gz -C /tmp \
    && mv /tmp/codex-x86_64-unknown-linux-musl /usr/local/bin/codex \
    && chmod +x /usr/local/bin/codex \
    && rm -f /tmp/codex.tar.gz \
    && codex --version || true
RUN echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jb2RleC1hZGFwdGVyL25vZGVfbW9kdWxlcy8uYmluL2NvZGV4LWFjcCAiJEAiCg==' \
      | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/codex \
      && chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/codex

# ---------------------------------------------------------------------------
# opencode — speaks ACP natively (`agent_manager.resolve_agent_process: resolved opencode
# native` in the daemon), so there is no separate ACP adapter package: only the binary, unpacked
# into its own dir with the launcher as a symlink (same collision-avoidance as codex/claude
# above). E2B sandboxes are x86-64, so linux-x64 is the correct asset regardless of the
# builder's host arch.
RUN curl -fsSL -o /tmp/opencode.tar.gz \
      https://github.com/anomalyco/opencode/releases/download/v1.17.13/opencode-linux-x64.tar.gz \
    && mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/opencode-bin \
    && tar -xzf /tmp/opencode.tar.gz -C /root/.local/share/sandbox-agent/bin/agent_processes/opencode-bin \
    && chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/opencode-bin/opencode \
    && rm -f /tmp/opencode.tar.gz \
    && ln -sf /root/.local/share/sandbox-agent/bin/agent_processes/opencode-bin/opencode \
      /root/.local/share/sandbox-agent/bin/agent_processes/opencode \
    && /root/.local/share/sandbox-agent/bin/agent_processes/opencode --version || true

# ---------------------------------------------------------------------------
# claude — like codex, the daemon shells the native `claude` CLI through the claude-agent-acp
# ACP adapter. Adapter installed into its own `claude-adapter` dir (collision-avoidance, see
# codex above); CLI fetched straight from Anthropic's own release bucket (never a third-party
# mirror — see build_snapshot.py's licensing note for why that boundary matters for Daytona).
# Pin note: this bucket has no immutable version-tag guarantee beyond the manifest.json at each
# path, so a version bump here is a deliberate re-pin, same as the other three harnesses.
# `@zed-industries/claude-agent-acp` is deprecated in favor of
# `@agentclientprotocol/claude-agent-acp`; kept on the old scope to match both the daemon's own
# pin and services/runner/package.json's `^0.23.1` — migrate all three together.
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/claude-adapter \
    && cd /root/.local/share/sandbox-agent/bin/agent_processes/claude-adapter \
    && npm install --ignore-scripts @zed-industries/claude-agent-acp@0.23.1
RUN curl -fsSL -o /usr/local/bin/claude \
      https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/2.1.187/linux-x64/claude \
    && chmod +x /usr/local/bin/claude \
    && claude --version || true
RUN echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jbGF1ZGUtYWRhcHRlci9ub2RlX21vZHVsZXMvLmJpbi9jbGF1ZGUtYWdlbnQtYWNwICIkQCIK' \
      | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/claude \
      && chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/claude

WORKDIR /root/work
