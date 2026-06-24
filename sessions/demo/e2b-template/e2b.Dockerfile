# E2B template: sandbox-agent + claude + codex + geesefs baked in.
# NOTE: `sandbox-agent install-agent` hangs in the E2B remote builder at the
# ACP-adapter step (registry resolution via cdn.agentclientprotocol.com stalls).
# Plain `npm install` works fine here, so we replicate install-agent's layout
# manually: native binary download (GCS/GitHub — works) + npm adapter + launcher.
FROM e2bdev/code-interpreter:latest

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git fuse procps sudo jq \
    && rm -rf /var/lib/apt/lists/*

# The E2B base ships node 20, but pi (@earendil-works/pi-coding-agent) requires node
# >=22.19 — on node 20 its ACP adapter crashes ("stream was destroyed"). Install node 22.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && node --version

RUN echo "user_allow_other" >> /etc/fuse.conf

# rivet sandbox-agent server binary
RUN curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh \
    && (command -v sandbox-agent || cp "$(find / -name sandbox-agent -type f 2>/dev/null | head -1)" /usr/local/bin/sandbox-agent) \
    && sandbox-agent --version

# NOTE: E2B's builder does not reliably carry ENV into later RUN layers, so all
# paths are hardcoded. sandbox-agent looks under ~/.local/share/sandbox-agent/bin.

# Claude: native CLI binary (GCS) + claude-agent-acp adapter (npm) + launcher
RUN mkdir -p /root/.local/share/sandbox-agent/bin && \
    CLAUDE_VER=$(curl -fsSL https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/stable) && \
    curl -fsSL -o /root/.local/share/sandbox-agent/bin/claude "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${CLAUDE_VER}/linux-x64/claude" && \
    chmod +x /root/.local/share/sandbox-agent/bin/claude
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/claude && \
    cd /root/.local/share/sandbox-agent/bin/agent_processes/claude && \
    npm install @agentclientprotocol/claude-agent-acp@^0.50.0 && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jbGF1ZGUvbm9kZV9tb2R1bGVzLy5iaW4vY2xhdWRlLWFnZW50LWFjcCAiJEAiCg==' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/claude-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/claude-acp

# Codex: native binary (GitHub) + codex-acp adapter (npm) + launcher
RUN curl -fsSL -o /tmp/codex.tgz "https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-musl.tar.gz" && \
    tar -xzf /tmp/codex.tgz -C /tmp && \
    mv "$(find /tmp -name 'codex-x86_64-unknown-linux-musl' -type f | head -1)" /root/.local/share/sandbox-agent/bin/codex && \
    chmod +x /root/.local/share/sandbox-agent/bin/codex && rm -f /tmp/codex.tgz
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/codex && \
    cd /root/.local/share/sandbox-agent/bin/agent_processes/codex && \
    npm install @agentclientprotocol/codex-acp@^1.0.0 && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jb2RleC9ub2RlX21vZHVsZXMvLmJpbi9jb2RleC1hY3AgIiRAIgo=' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/codex-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/codex-acp

# opencode: native x64 binary (anomalyco release) + launcher that execs `opencode acp`.
# E2B sandboxes are real x86_64, so the linux-x64 build is correct (no arch-fix needed).
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/opencode && \
    curl -fsSL -o /tmp/oc.tgz "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz" && \
    rm -rf /tmp/ocx && mkdir -p /tmp/ocx && tar -xzf /tmp/oc.tgz -C /tmp/ocx && \
    install -m755 "$(find /tmp/ocx -name opencode -type f | head -1)" /root/.local/share/sandbox-agent/bin/agent_processes/opencode/opencode && \
    install -m755 "$(find /tmp/ocx -name opencode -type f | head -1)" /root/.local/share/sandbox-agent/bin/opencode && \
    rm -rf /tmp/oc.tgz /tmp/ocx && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9vcGVuY29kZS9vcGVuY29kZSBhY3AgIiRAIgo=' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/opencode-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/opencode-acp

# pi: pi-acp adapter (npm) + the real pi CLI (global npm) + launcher
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/pi && \
    cd /root/.local/share/sandbox-agent/bin/agent_processes/pi && \
    npm install pi-acp@^0.0.31 && \
    npm install -g @earendil-works/pi-coding-agent@0.80.2 && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9waS9ub2RlX21vZHVsZXMvLmJpbi9waS1hY3AgIiRAIgo=' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/pi-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/pi-acp

# geesefs static binary (linux-amd64; E2B sandboxes are x86_64)
COPY geesefs /usr/local/bin/geesefs
RUN chmod +x /usr/local/bin/geesefs
