# Verifying a deployment

Run these after every deploy or config change. They prove the stack is actually serving, not
just that containers are "up". Replace `localhost` with your host and adjust the port if you
changed `TRAEFIK_PORT`. Container names assume the default `COMPOSE_PROJECT_NAME`.

## 1. API health -> 200

The API mounts under `/api` (via `root_path` / `SCRIPT_NAME`), so through Traefik the health
route is `/api/health`:

```bash
curl -fsS http://localhost/api/health && echo OK
```

A 200 with a JSON body means the API and its DB migrations are up. A 404 usually means the
web/proxy URL vars are wrong (the env-file trap in operate.md).

## 2. Runner health from inside the Services container

Services reaches the runner over the internal Docker network at `http://runner:8765`. Check
that path, not just the runner in isolation:

```bash
docker compose exec api curl -fsS http://runner:8765/health
```

The runner returns its identity (`status`, `runner`, `protocol`, `engines`, `harnesses`). If
this fails but the runner container is up, Services and the runner are on different networks
or `AGENTA_RUNNER_INTERNAL_URL` is wrong (troubleshoot.md entry 1).

## 3. Runner startup log: the provider-config line

On start the runner validates its configuration once and logs a single redacted summary. A
bad provider list, a Daytona provider with no credential, or an invalid lifecycle value
fails startup here rather than at first run:

```bash
docker compose logs runner | grep '\[sandbox-agent\]'
```

Look for the config summary and `http server listening on 0.0.0.0:8765`. You will also see
one egress line: restricted mode (the default) or a WARNING if
`AGENTA_INSECURE_EGRESS_ALLOWED` is set.

## 4. Daytona: sandbox count returns to 0 after a run

If Daytona is enabled, a healthy run creates a sandbox and tears it down when it finishes. A
count that stays above 0 after runs complete means sandboxes are leaking. Check the count in
your Daytona dashboard (or API) right after a run finishes; it should return to 0. The
Daytona how-to has the smoke test: https://docs.agenta.ai/self-host/agent-execution/daytona .

## 5. Published ports are loopback-bound

On a public host, confirm Postgres and the Traefik dashboard are not exposed to the internet:

```bash
docker compose ps --format '{{.Service}}\t{{.Ports}}' | grep -E 'postgres|traefik'
```

The Postgres (`5432`) and dashboard (`8080`) mappings must show `127.0.0.1:`, not
`0.0.0.0:`. If they show `0.0.0.0`, harden them (harden.md entry 1).
</content>
