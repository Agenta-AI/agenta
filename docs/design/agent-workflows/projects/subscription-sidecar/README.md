# Subscription-auth Claude sidecar (dev/test)

A reproducible recipe for standing up a **second** agent-runner sidecar that authenticates
Claude Code with a **Claude subscription (OAuth)** instead of an `ANTHROPIC_API_KEY`. The host's
own Claude login is mounted **read-only** into the container; Claude Code is installed at runtime
and authenticates entirely off that mounted login. No API key is set anywhere.

This is a **standalone DEV/TEST target**. It is intentionally **not wired into the app**: it does
not change the main stack, the compose files, or any app config. Its purpose is to be an easy
target for testing **self-managed (subscription) Claude authentication** — later reachable through
the playground's composite sidecar URI (`{mode, url}` → the agent config `uri` field; see
[Wiring it in later](#wiring-it-in-later)).

> **Status:** verified working on 2026-06-25. Two `/run` turns on `harness=claude`, `model=haiku`,
> with no API key, returned correct output using only the mounted subscription OAuth.

## Why this works without a code change

The runner already supports an ambient-auth ("self-managed" / `runtime_provided`) path. On a run
where no resolved provider key is supplied, the `sandbox_agent` engine **keeps the inherited
environment and the harness's own login** rather than clearing it (the clear-then-apply discipline
only clears provider creds on a *managed* run). For Claude Code that login lives in
`~/.claude/.credentials.json`, read via `$HOME` / `CLAUDE_CONFIG_DIR`. So the only thing this
recipe adds is **infrastructure**: mount the host's Claude login and run the existing image. See
`services/agent/src/engines/sandbox_agent/daemon.ts` (`buildDaemonEnv` inherits `HOME` /
`CLAUDE_CONFIG_DIR` and, on a non-managed run, keeps ambient auth) and
`services/agent/docker/README.md` ("OAuth subscription (self-host opt-in only)").

## The host auth folder

Claude Code stores its subscription OAuth in:

```
~/.claude/.credentials.json
```

Confirm it is a **subscription/OAuth** login (not an API key) before mounting:

```bash
python3 - <<'PY'
import json, os
d = json.load(open(os.path.expanduser("~/.claude/.credentials.json")))["claudeAiOauth"]
print("subscriptionType:", d["subscriptionType"])   # e.g. "max" / "pro"
print("token prefix:", d["accessToken"][:14])        # "sk-ant-oat01-" = OAuth, not "sk-ant-api"
print("scopes:", d["scopes"])                        # includes user:inference, user:sessions:claude_code
PY
```

`sk-ant-oat01-…` is an OAuth access token; `sk-ant-api…` would be an API key. A `subscriptionType`
of `max`/`pro` and the `user:inference` + `user:sessions:claude_code` scopes confirm the
subscription path.

> Some hosts also keep `~/.claude.json` and `~/.config/claude/`. The **credential** is
> `~/.claude/.credentials.json`; mounting the whole `~/.claude` directory read-only is the simplest
> way to give Claude Code its config dir and login together.

### If the host has no subscription login

If `~/.claude/.credentials.json` is absent (or only an `ANTHROPIC_API_KEY` is configured, with no
`claudeAiOauth` block), this host is **API-key only** and cannot exercise the subscription path. To
enable it, run `claude` once interactively and choose the subscription login; the OAuth file then
appears at the path above. The mount and run commands below are otherwise identical.

## Run the second sidecar

Reuses the already-built runner image (no rebuild). Picks a **distinct host port** so it never
collides with the main stack (`:8280` web, sidecar internal `:8765`) or any other running sidecar.

```bash
REPO=/path/to/agenta                     # repo root
IMAGE=agenta-ee-dev-sandbox-agent:latest # any built runner image; the prod docker/Dockerfile works too
HOST_PORT=8790                           # distinct, loopback-only; change if taken

docker rm -f agenta-claude-sub-sidecar 2>/dev/null || true

docker run -d \
  --name agenta-claude-sub-sidecar \
  --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:${HOST_PORT}:8765 \
  -e PORT=8765 \
  -e AGENTA_AGENT_RUNNER_HOST=0.0.0.0 \
  -e NODE_ENV=development \
  -e HOME=/home/agent \
  -e PI_CODING_AGENT_DIR=/pi-agent \
  -e SANDBOX_AGENT_PROVIDER=local \
  --tmpfs /home/agent:exec,uid=$(id -u),gid=$(id -g) \
  -v "$REPO/services/agent/src":/app/src:ro \
  -v "$REPO/services/agent/skills":/app/skills:ro \
  -v "$HOME/.claude":/home/agent/.claude:ro \
  "$IMAGE" \
  node_modules/.bin/tsx src/server.ts
```

Why each piece:

- **`--user $(id -u):$(id -g)`** — run as the host user so the container can *read* the mounted
  `~/.claude` (owned by that user, mode `0600`). It also means **no** `ANTHROPIC_API_KEY` is
  inherited (the host shell has none in the subscription setup).
- **`-p 127.0.0.1:8790:8765`** — loopback only. The runner ships resolved secrets in `/run` bodies,
  so it must never be exposed off-host (matches the trust model). `8790` avoids `8280/8281`,
  `8380/8381`, `8480` (web stacks), `8766` (in use here), and `5432/5434/5435` (Postgres).
- **`HOME=/home/agent` + `--tmpfs /home/agent`** — a **writable** HOME so Claude Code can write its
  own runtime state (session files, etc.). The credential is mounted **into** this HOME at
  `/home/agent/.claude` read-only.
- **`-v $HOME/.claude:/home/agent/.claude:ro`** — the **read-only** subscription mount. Claude Code
  reads the OAuth login from here; it cannot modify the host's credentials.
- **`-v …/src:ro` and `-v …/skills:ro`** — mirror how the real sidecar serves source and the
  Agenta forced skills. Read-only since this container only serves the runner.
- **CMD `node_modules/.bin/tsx src/server.ts`** — run the server directly. Skip the dev image's
  `build-extension` step: the image already baked the extension at build time, and a non-root user
  cannot rewrite `/app/dist`. The baked extension is fine for a Claude run.
- **No `ANTHROPIC_API_KEY`, no `secrets`** — that is the whole point. Auth is the mounted OAuth.

Health check:

```bash
curl -s http://127.0.0.1:8790/health
# {"status":"ok","runner":"0.1.0","protocol":1,"engines":["sandbox-agent"],"harnesses":["pi_core","claude","pi_agenta"]}
```

## Verify subscription auth (no API key)

A minimal, cheap Claude turn on `haiku`. The runner installs Claude Code at runtime (the daemon's
`install-agent claude`, ~10s on the first call) and authenticates off the mounted OAuth.

```bash
curl -s -X POST http://127.0.0.1:8790/run \
  -H 'content-type: application/json' \
  -d '{
        "harness": "claude",
        "sandbox": "local",
        "model": "haiku",
        "credentialMode": "runtime_provided",
        "messages": [
          { "role": "user", "content": "Reply with exactly: hi from subscription claude. Nothing else." }
        ]
      }'
```

Observed result (2026-06-25):

```json
{ "ok": true, "output": "hi from subscription claude.", "model": "haiku", "stopReason": "end_turn" }
```

- `credentialMode: "runtime_provided"` tells the runner the harness owns its login — keep ambient
  auth, do not expect a resolved key. (`model: "haiku"` is the Claude alias; the runner falls back
  to the harness default if an alias is not settable.)
- Proof it was the subscription, not a key:

  ```bash
  docker exec agenta-claude-sub-sidecar sh -c \
    'env | grep -iE "ANTHROPIC|CLAUDE_CODE_OAUTH|OPENAI" || echo "(no provider key env — subscription-only)"'
  # (no provider key env — subscription-only)

  docker exec agenta-claude-sub-sidecar ls -l /home/agent/.claude/.credentials.json
  # -rw------- ... /home/agent/.claude/.credentials.json   (the mounted OAuth login)
  ```

Tear down when done:

```bash
docker rm -f agenta-claude-sub-sidecar
```

## Security notes

- **Read-only mount.** `~/.claude` is mounted `:ro`. The container reads the OAuth login; it cannot
  write or rotate the host's credentials. This is the recommended posture.
- **Subscription auth is DEV/TEST and individual-use only.** Anthropic restricts Free/Pro/Max OAuth
  to first-party, individual use and forbids third parties routing other users' requests through it
  (enforced since 2026-03). **Never** use this sidecar to serve other users. Cloud and multi-tenant
  deployments must stay **API-key only**. See `services/agent/docker/README.md`.
- **Never bake or distribute Claude Code.** Claude Code is proprietary (Anthropic Commercial
  Terms): a usage license, no redistribution right. The image here bakes **only** Pi (MIT). Claude
  Code is installed **from Anthropic at runtime** by the daemon, which keeps Anthropic the
  distributor — the only compliant path for an image we build.
- **No credential is baked.** The image contains no API key and no OAuth login. Auth arrives only
  via the runtime mount.
- **Loopback only.** Bind the host port to `127.0.0.1`. The runner trusts its caller with resolved
  secrets; do not expose it off-host.
- **Token refresh caveat.** Because the mount is read-only, Claude Code cannot rewrite a refreshed
  access token back to the host file. A single short turn well inside the token's validity window
  succeeds (verified). If your access token is at/near expiry, either refresh it on the host first
  (run `claude` once) or, for a dev session only, mount a **writable copy** of `~/.claude` instead
  of the live directory. Prefer refreshing on the host and keeping the mount read-only.

## Wiring it in later

This sidecar is built so the playground can point at it via the **composite sidecar URI** the
config carries (`{mode, url}` → the agent config `uri` field). When that is wired:

1. The agent config's `uri` resolves (server-side) to this sidecar's address.
2. The address must be on the server-side allowlist `AGENTA_AGENT_RUNNER_URI_ALLOWLIST`
   (default empty = the feature is off; a disallowed `uri` fails loud, no silent fallback) —
   an SSRF / secret-exfiltration guard because `/run` bodies carry resolved secrets.
3. A run with the `self_managed` connection mode and no resolved key reaches this sidecar, which
   authenticates Claude off the mounted subscription.

For that mechanism see [`../sidecar-uri-config/`](../sidecar-uri-config/) (the `uri` field, routing
precedence, and the allowlist) and [`../sidecar-trust-and-sandbox-enforcement/`](../sidecar-trust-and-sandbox-enforcement/)
(why a caller-supplied address is restricted).

## Related

- `services/agent/docker/README.md` — image licensing posture and the auth options (API key vs the
  OAuth self-host opt-in this recipe implements).
- `services/agent/src/engines/sandbox_agent/daemon.ts` — `buildDaemonEnv`: inherits `HOME` /
  `CLAUDE_CONFIG_DIR`, keeps ambient auth on a non-managed run.
- `sdks/python/agenta/sdk/agents/capabilities.py` — `CLAUDE_MODEL_ALIASES` (`default`/`sonnet`/
  `opus`/`haiku` and `[1m]` variants).
</content>
</invoke>
