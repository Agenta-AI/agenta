# Local docker sandbox image: sandbox-agent + claude + codex + opencode + pi + geesefs.
# Used by the SDK's built-in `docker` provider (fresh container per session, AutoRemove).
# Mirrors the e2b template / daytona snapshot — x86_64 binaries; cwd is /root/work.
#   docker build -t agenta-sandbox-agent:local docker-image/
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git fuse procps sudo jq \
    && rm -rf /var/lib/apt/lists/*

# node 22 (pi needs >=22.19)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs && node --version

RUN echo "user_allow_other" >> /etc/fuse.conf

# rivet sandbox-agent server binary
RUN curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh \
    && (command -v sandbox-agent || cp "$(find / -name sandbox-agent -type f 2>/dev/null | head -1)" /usr/local/bin/sandbox-agent) \
    && sandbox-agent --version

# claude: native binary + adapter + launcher
RUN mkdir -p /root/.local/share/sandbox-agent/bin && \
    CLAUDE_VER=$(curl -fsSL https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/stable) && \
    curl -fsSL -o /root/.local/share/sandbox-agent/bin/claude "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${CLAUDE_VER}/linux-x64/claude" && \
    chmod +x /root/.local/share/sandbox-agent/bin/claude
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/claude && \
    cd /root/.local/share/sandbox-agent/bin/agent_processes/claude && \
    npm install @agentclientprotocol/claude-agent-acp@^0.50.0 && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jbGF1ZGUvbm9kZV9tb2R1bGVzLy5iaW4vY2xhdWRlLWFnZW50LWFjcCAiJEAiCg==' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/claude-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/claude-acp

# codex: native binary + adapter + launcher
RUN curl -fsSL -o /tmp/codex.tgz "https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-musl.tar.gz" && \
    tar -xzf /tmp/codex.tgz -C /tmp && \
    mv "$(find /tmp -name 'codex-x86_64-unknown-linux-musl' -type f | head -1)" /root/.local/share/sandbox-agent/bin/codex && \
    chmod +x /root/.local/share/sandbox-agent/bin/codex && rm -f /tmp/codex.tgz
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/codex && \
    cd /root/.local/share/sandbox-agent/bin/agent_processes/codex && \
    npm install @agentclientprotocol/codex-acp@^1.0.0 && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9jb2RleC9ub2RlX21vZHVsZXMvLmJpbi9jb2RleC1hY3AgIiRAIgo=' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/codex-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/codex-acp

# opencode: native x64 binary + launcher
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/opencode && \
    curl -fsSL -o /tmp/oc.tgz "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz" && \
    rm -rf /tmp/ocx && mkdir -p /tmp/ocx && tar -xzf /tmp/oc.tgz -C /tmp/ocx && \
    install -m755 "$(find /tmp/ocx -name opencode -type f | head -1)" /root/.local/share/sandbox-agent/bin/agent_processes/opencode/opencode && \
    install -m755 "$(find /tmp/ocx -name opencode -type f | head -1)" /root/.local/share/sandbox-agent/bin/opencode && \
    rm -rf /tmp/oc.tgz /tmp/ocx && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9vcGVuY29kZS9vcGVuY29kZSBhY3AgIiRAIgo=' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/opencode-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/opencode-acp

# pi: adapter + real CLI + launcher
RUN mkdir -p /root/.local/share/sandbox-agent/bin/agent_processes/pi && \
    cd /root/.local/share/sandbox-agent/bin/agent_processes/pi && \
    npm install pi-acp@^0.0.31 && \
    npm install -g @earendil-works/pi-coding-agent@0.80.2 && \
    echo 'IyEvdXNyL2Jpbi9lbnYgc2gKc2V0IC1lCmV4ZWMgL3Jvb3QvLmxvY2FsL3NoYXJlL3NhbmRib3gtYWdlbnQvYmluL2FnZW50X3Byb2Nlc3Nlcy9waS9ub2RlX21vZHVsZXMvLmJpbi9waS1hY3AgIiRAIgo=' | base64 -d > /root/.local/share/sandbox-agent/bin/agent_processes/pi-acp && \
    chmod +x /root/.local/share/sandbox-agent/bin/agent_processes/pi-acp

# geesefs static binary — match the build arch (arm64 on Apple Silicon, amd64 on x86)
RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in arm64) GA=geesefs-linux-arm64 ;; *) GA=geesefs-linux-amd64 ;; esac && \
    curl -fsSL -o /usr/local/bin/geesefs "https://github.com/yandex-cloud/geesefs/releases/latest/download/$GA" \
    && chmod +x /usr/local/bin/geesefs && /usr/local/bin/geesefs --version 2>/dev/null || true

WORKDIR /root
# the SDK's docker provider runs Cmd: ["server", ...] — it expects sandbox-agent as the
# entrypoint so those become its args.
ENTRYPOINT ["sandbox-agent"]
