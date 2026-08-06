#!/usr/bin/env bash
# P7 derisk probe: can codex's bundled bubblewrap sandbox initialize inside the runner image?
# Runs `codex sandbox` (no model involved) from the codex-acp-bundled musl vendor dir, on the
# host and in throwaway containers from the SAME image the live runner uses, under a matrix of
# docker security configs. Output: transcripts/p7-bwrap-matrix.log
set -u
V=$HOME/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl
IMAGE=agenta-ee-dev-runner:latest
OUT=/home/mahmoud/code/agenta/.claude/worktrees/codex-harness/docs/design/codex-harness/spike/transcripts/p7-bwrap-matrix.log
: > "$OUT"
log() { echo "$@" | tee -a "$OUT"; }

log "date: $(date -Is)"
log "image: $IMAGE   host kernel: $(uname -r)"
log "host sysctls: $(sysctl kernel.apparmor_restrict_unprivileged_userns kernel.unprivileged_userns_clone 2>/dev/null | tr '\n' ' ')"
log ""

CMD='mkdir -p /tmp/p7ws /tmp/p7home && echo "approval_policy = \"never\"" > /tmp/p7home/config.toml && cd /tmp/p7ws && CODEX_HOME=/tmp/p7home /opt/codex-vendor/bin/codex sandbox -c "sandbox_mode=\"workspace-write\"" -- sh -c "echo p7-marker-ran"; echo rc=$?'

log "--- host (no container) ---"
mkdir -p /tmp/codex-derisk/ws-p7 /tmp/codex-derisk/home-p7
echo 'approval_policy = "never"' > /tmp/codex-derisk/home-p7/config.toml
( cd /tmp/codex-derisk/ws-p7 && CODEX_HOME=/tmp/codex-derisk/home-p7 "$V/bin/codex" sandbox -c 'sandbox_mode="workspace-write"' -- sh -c 'echo p7-marker-ran' 2>&1; echo "rc=$?" ) | grep -v "PATH aliases" | tee -a "$OUT"

variant() {
  local name=$1; shift
  log ""
  log "--- $name : docker run $* ---"
  docker run -d --rm --name "$name" "$@" "$IMAGE" sleep 300 >/dev/null
  docker cp "$V" "$name":/opt/codex-vendor >/dev/null 2>&1
  docker exec "$name" sh -c "$CMD" 2>&1 | grep -v "PATH aliases" | tee -a "$OUT"
  docker rm -f "$name" >/dev/null 2>&1
}

variant p7m-default
variant p7m-netadmin --cap-add NET_ADMIN
variant p7m-seccomp --security-opt seccomp=unconfined
variant p7m-seccomp-netadmin --security-opt seccomp=unconfined --cap-add NET_ADMIN
variant p7m-seccomp-apparmor --security-opt seccomp=unconfined --security-opt apparmor=unconfined
variant p7m-capsonly --cap-add SYS_ADMIN --cap-add NET_ADMIN
variant p7m-caps-apparmor --cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt apparmor=unconfined
variant p7m-full --security-opt seccomp=unconfined --security-opt apparmor=unconfined --cap-add SYS_ADMIN --cap-add NET_ADMIN
variant p7m-privileged --privileged

log ""
log "--- enforcement check in the minimal working config ---"
docker run -d --rm --name p7m-enforce --security-opt seccomp=unconfined --security-opt apparmor=unconfined --cap-add SYS_ADMIN --cap-add NET_ADMIN "$IMAGE" sleep 300 >/dev/null
docker cp "$V" p7m-enforce:/opt/codex-vendor >/dev/null 2>&1
docker exec p7m-enforce sh -c 'mkdir -p /tmp/p7ws /tmp/p7home && echo "approval_policy = \"never\"" > /tmp/p7home/config.toml && cd /tmp/p7ws && CODEX_HOME=/tmp/p7home /opt/codex-vendor/bin/codex sandbox -c "sandbox_mode=\"workspace-write\"" -- sh -c "touch /p7-outside 2>&1; echo outside-touch-rc=\$?; touch inside.txt; echo inside-touch-rc=\$?"' 2>&1 | grep -v "PATH aliases" | tee -a "$OUT"
docker rm -f p7m-enforce >/dev/null 2>&1
log ""
log "done"
