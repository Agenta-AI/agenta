---
name: subscription-sidecar
description: Stand up the agent-runner "subscription sidecar" that authenticates harnesses with a personal subscription (Claude Code OAuth and/or the OpenAI ChatGPT/Codex OAuth) instead of an API key, and wire the local app to it. Use when testing the self-managed (no-API-key) agent path, when "use my Claude/ChatGPT subscription in the playground" comes up, or when a codex/Claude self_managed run fails because the sidecar the app talks to has no matching login.
allowed-tools: Read, Edit, Write, Bash
user-invocable: true
---

# Subscription sidecar (Claude + Codex, no API key)

Stand up a second agent-runner sidecar that authenticates harnesses with a **personal
subscription OAuth** instead of an `*_API_KEY`, and point the local app at it. One sidecar can
serve both subscriptions at once: Claude Code off `~/.claude`, and Pi's `openai-codex` (the
ChatGPT/Codex subscription) off `~/.pi/agent`.

Design detail and rationale live in
`docs/design/agent-workflows/projects/subscription-sidecar/README.md`. This skill is the short
operating procedure.

## Why this exists (the one load-bearing fact)

The runner has a `runtime_provided` ("self-managed") auth path: on a run with no resolved vault
key, the `sandbox_agent` engine keeps the inherited env and the harness's own login instead of
clearing it. So the only thing this recipe adds is **infrastructure**: mount the host's
subscription login into the container and run the existing image. No key is set anywhere.

The login each harness reads:

| Harness / provider | Login file on the host | Created by |
| --- | --- | --- |
| `claude` | `~/.claude/.credentials.json` (OAuth, token `sk-ant-oat01-…`) | `claude` once, pick subscription login |
| `pi_core`/`pi_agenta` + `openai-codex` | `~/.pi/agent/auth.json` (provider key `openai-codex`) | `cd services/runner && pnpm exec pi` then `/login` → ChatGPT |

`openai-codex` is a **distinct Pi provider** (endpoint `chatgpt.com/backend-api`), not the plain
`openai` provider (endpoint `api.openai.com`, `OPENAI_API_KEY`). The model id must name it:
`openai-codex/gpt-5.5`. `self_managed` only says "use my own login", not *which* OpenAI endpoint,
so the provider id is what routes to the subscription.

## 0. Confirm the host logins

```bash
# Codex (Pi): expect provider key "openai-codex" with access/refresh/expires
python3 -c "import json;print(list(json.load(open('$HOME/.pi/agent/auth.json')).keys()))"
# Claude: expect a claudeAiOauth block with subscriptionType max/pro and an sk-ant-oat01- token
python3 -c "import json;print(json.load(open('$HOME/.claude/.credentials.json'))['claudeAiOauth']['subscriptionType'])"
```

If a file is missing, log in on the host first (table above). Skip the harness you do not need
and drop its mount below.

## 1. Run the sidecar

Pick the values, then run. Verified-working command (loopback-only; one writable copy of the Pi
login so token refresh never fails mid-run; Claude mounted read-only).

```bash
REPO=/home/mahmoud/code/agenta
IMAGE=agenta-ee-dev-runner:latest                   # any built runner image
NET=agenta-ee-dev-wp-b2-rendering_agenta-network    # the app stack's compose network (docker network ls)
HOST_PORT=8790                                       # distinct loopback port

docker rm -f agenta-claude-sub-sidecar 2>/dev/null || true
docker run -d \
  --name agenta-claude-sub-sidecar \
  --user "$(id -u):$(id -g)" \
  --network "$NET" \
  -p 127.0.0.1:${HOST_PORT}:8765 \
  -e PORT=8765 -e AGENTA_RUNNER_HOST=0.0.0.0 -e NODE_ENV=development \
  -e HOME=/home/agent -e PI_CODING_AGENT_DIR=/home/agent/.pi/agent -e SANDBOX_AGENT_PROVIDER=local \
  --tmpfs /home/agent:exec,uid=$(id -u),gid=$(id -g) \
  -v "$REPO/services/runner/src":/app/src:ro \
  -v "$REPO/services/runner/skills":/app/skills:ro \
  -v "$HOME/.claude":/home/agent/.claude:ro \
  -v "$HOME/.pi/agent":/pi-agent-ro:ro \
  "$IMAGE" \
  sh -c "mkdir -p /home/agent/.pi/agent && cp -a /pi-agent-ro/. /home/agent/.pi/agent/ 2>/dev/null || true; exec node_modules/.bin/tsx src/server.ts"
```

Why each non-obvious piece:

- **`--user $(id -u):$(id -g)`** runs as you, so the container can read your mode-0600 logins and
  inherits **no** `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (the whole point).
- **`--network <app-stack-network>`** so the app's `services`/`api` containers can reach it by name.
- **`~/.pi/agent` mounted read-only and copied to a writable `HOME/.pi/agent`** (set as
  `PI_CODING_AGENT_DIR`): Pi refreshes its OAuth token in-container without writing back to the
  host file and without polluting your host Pi sessions. (`~/.claude` stays read-only; a single
  short Claude turn lives inside the token window. If your Claude token is near expiry, refresh on
  the host with `claude`.)
- **No `env_file`, no `secrets`**: auth is only the mounted login.

## 2. Point the app at it

The app reaches the runner via `AGENTA_RUNNER_URL`. Set it in the stack's env file to this
sidecar, then recreate the `services` (and `api`) containers so they pick it up:

```
AGENTA_RUNNER_URL=http://agenta-claude-sub-sidecar:8765
```

Verify what the live service is actually pointed at (it is NOT always the compose `runner`):

```bash
docker exec <stack>-services-1 sh -c 'echo $AGENTA_RUNNER_URL'
```

If a `self_managed` codex/Claude run fails with a missing-login error, the cause is almost always
that the sidecar the app points at does not carry that harness's login. Add the mount (this
recipe) or repoint the URL.

## 3. Verify

```bash
PORT=8790
# health: harnesses pi_core, claude, pi_agenta
curl -s http://127.0.0.1:$PORT/health

# both logins present in the container, no key
docker exec agenta-claude-sub-sidecar sh -c '
  python3 -c "import json;print(\"codex:\",list(json.load(open(\"/home/agent/.pi/agent/auth.json\")).keys()))"
  ls /home/agent/.claude/.credentials.json >/dev/null 2>&1 && echo "claude: present"
  [ -z "$OPENAI_API_KEY$ANTHROPIC_API_KEY" ] && echo "no provider key env (good)"'

# a codex turn on the subscription (no key)
curl -s -X POST http://127.0.0.1:$PORT/run -H 'content-type: application/json' -d '{
  "harness":"pi_core","sandbox":"local","model":"openai-codex/gpt-5.4-mini",
  "credentialMode":"runtime_provided","messages":[{"role":"user","content":"Say OK"}]}'

# a Claude turn on the subscription (no key)
curl -s -X POST http://127.0.0.1:$PORT/run -H 'content-type: application/json' -d '{
  "harness":"claude","sandbox":"local","model":"haiku",
  "credentialMode":"runtime_provided","messages":[{"role":"user","content":"Say OK"}]}'
```

Both should return `{"ok":true, ...}`.

## 4. Configure the agent in the playground

- Codex subscription: harness `pi_core`/`pi_agenta`, provider **`openai-codex`**, model `gpt-5.5`
  / `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.3-codex-spark`, connection mode **`self_managed`**.
- Claude subscription: harness `claude`, a Claude alias model (`haiku`/`sonnet`/`opus`),
  connection mode **`self_managed`**.

`self_managed` ignores any stored vault key and uses the subscription. The capability table that
gates this (and feeds the model picker) is `sdks/python/agenta/sdk/agents/capabilities.py`; after
editing it, **restart the `services` AND `api` containers** (both mount `sdks/python` but uvicorn
reload only watches `/app`).

## Security and teardown

- **Loopback only** (`127.0.0.1`). The runner trusts its caller with resolved secrets; never
  expose it off-host.
- **Subscription auth is dev/test, individual-use only.** Anthropic and OpenAI restrict personal
  subscription OAuth to first-party use. Never route other users' traffic through it. Cloud and
  multi-tenant deployments stay **API-key only**.
- **Never bake or distribute Claude Code** (proprietary). The image bakes only Pi (MIT); Claude is
  installed from Anthropic at runtime by the daemon. No credential is baked.
- Teardown: `docker rm -f agenta-claude-sub-sidecar`. Repoint `AGENTA_RUNNER_URL` back and
  recreate `services`/`api` if you changed it.
