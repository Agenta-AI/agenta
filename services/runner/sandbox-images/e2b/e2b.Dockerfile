# E2B baked template: sandbox-agent daemon + Pi. Pi-only; other harnesses deferred.
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

# pi-acp adapter; versions match services/agent/package.json pins
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

# opencode is auto-installed at runtime by the daemon (install-agent opencode).
# E2B runs on real x86-64 cloud hardware so the default linux-x64 Bun binary is correct.
# No arch override needed here (the SIGTRAP gotcha only affects local arm64 dev machines).

WORKDIR /root/work
