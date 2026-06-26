FROM node:22-bookworm-slim

# Tools: curl/git for installs, fuse for geesefs, ca-certs for TLS to S3/Anthropic
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git fuse procps \
    && rm -rf /var/lib/apt/lists/*

# Allow non-root + allow_other FUSE mounts (geesefs mounts under /work)
RUN echo "user_allow_other" >> /etc/fuse.conf

# rivet sandbox-agent server binary
RUN curl -fsSL https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh | sh \
    && (command -v sandbox-agent || cp "$(find / -name sandbox-agent -type f 2>/dev/null | head -1)" /usr/local/bin/sandbox-agent) \
    && sandbox-agent --version

# Agent binaries + ACP adapters baked at build time, each isolated so one failure
# doesn't sink the others. claude + codex are known-good.
RUN sandbox-agent install-agent claude
RUN sandbox-agent install-agent codex
# opencode: rivet's installer fetches the linux-x64 Bun binary even on arm64 hosts,
# so on arm64 it lands a wrong-arch binary that SIGTRAPs under Rosetta. Install-agent
# (fail-soft for the verify crash), then overwrite the native binary with the correct
# arch build from the anomalyco release so `opencode acp` actually runs.
RUN sandbox-agent install-agent opencode || echo "opencode install-agent verify failed (fixing arch below)"
RUN set -e; \
    ARCH=$(dpkg --print-architecture); \
    case "$ARCH" in \
      arm64) OC=opencode-linux-arm64 ;; \
      amd64) OC=opencode-linux-x64 ;; \
      *) OC=opencode-linux-x64 ;; \
    esac; \
    rm -rf /tmp/ocfix && mkdir -p /tmp/ocfix; \
    curl -fsSL -o /tmp/ocfix/oc.tgz "https://github.com/anomalyco/opencode/releases/latest/download/${OC}.tar.gz"; \
    tar -xzf /tmp/ocfix/oc.tgz -C /tmp/ocfix; \
    OCBIN=$(find /tmp/ocfix -name opencode -type f | head -1); \
    install -m755 "$OCBIN" /root/.local/share/sandbox-agent/bin/opencode; \
    install -m755 "$OCBIN" /root/.local/share/sandbox-agent/bin/agent_processes/opencode/opencode; \
    rm -rf /tmp/ocfix; \
    /root/.local/share/sandbox-agent/bin/opencode --version
# pi: install-agent gives only the pi-acp adapter; the actual `pi` CLI is a separate
# npm package (earendil-works, headless, plain API key).
RUN sandbox-agent install-agent pi || echo "pi install-agent returned non-zero (continuing)"
RUN npm install -g @earendil-works/pi-coding-agent@0.80.2

# geesefs static binary (linux, arch matches build platform)
COPY bin/geesefs /usr/local/bin/geesefs
RUN chmod +x /usr/local/bin/geesefs

COPY sandbox/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /work
EXPOSE 2468

# Entrypoint seeds codex auth.json, then serves (no token; bind all interfaces for the sidecar)
CMD ["/usr/local/bin/entrypoint.sh"]
