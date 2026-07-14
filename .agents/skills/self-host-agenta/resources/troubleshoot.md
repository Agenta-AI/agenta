# Troubleshooting

Field-verified failures, keyed to the exact error text you will see. Each entry is
symptom -> cause -> fix. If your symptom is not here, the configuration reference
(https://docs.agenta.ai/self-host/configuration) and networking doc
(https://docs.agenta.ai/self-host/infrastructure/networking) are the next stops.

## 1. `could not find runner CLI at /app/runner/src/cli.ts`

**Symptom.** An agent run fails and the Services logs show a message like
`<backend> could not find runner CLI at /app/runner/src/cli.ts`.

**Cause.** The Services API did not get a runner URL, so the SDK adapter fell back to
launching the runner as a subprocess and looked for its CLI on disk. The Services image
does not contain the runner, so the CLI is not there. This means `AGENTA_RUNNER_INTERNAL_URL`
is unset or was overridden to empty in your env file.

**Fix.** Point Services at the runner container over HTTP:

```bash
AGENTA_RUNNER_INTERNAL_URL=http://runner:8765
```

The Compose files default this to `http://runner:8765` already, so this bites when a custom
env file blanks it out. Confirm your env file does not set `AGENTA_RUNNER_INTERNAL_URL=` to
empty. Runner variables reference:
https://docs.agenta.ai/self-host/agent-execution/runner-configuration .

## 2. Behind a reverse proxy or Cloudflare, redirects come back as `http://` and drop `/api`

**Symptom.** The stack works on a plain IP, but once you put a proxy (Cloudflare, an
upstream nginx, a load balancer) in front, API calls 307/308-redirect to a `http://` URL and
sometimes lose the `/api` prefix. Login loops or mixed-content errors follow.

**Cause.** The API runs under gunicorn's Uvicorn worker, which only trusts forwarded
headers (`X-Forwarded-Proto`, `X-Forwarded-For`) from clients in its trusted list. The
immediate client is now the proxy, not loopback, so Uvicorn ignores the `https` signal and
builds `http://` redirects. Traefik, in turn, does not trust forwarded headers from the
upstream proxy by default.

**Fix.** Trust the proxy at both hops.

1. Tell Uvicorn to trust forwarded headers from any client, in your env file:

   ```bash
   FORWARDED_ALLOW_IPS=*
   ```

2. Tell Traefik to trust forwarded headers on the web entrypoint. Add to the `traefik`
   service command in your Compose file:

   ```yaml
   - --entrypoints.web.forwardedHeaders.insecure=true
   ```

Set `FORWARDED_ALLOW_IPS=*` only when a trusted proxy sits in front of the stack. It tells
Uvicorn to believe the `X-Forwarded-*` headers on every request.

## 3. Subscription run behaves as if you never logged in

**Symptom.** You mounted `~/.claude` (or another harness login) into the runner for a
personal-subscription run, but the harness prompts to log in again or fails to authenticate.

**Cause.** The runner container runs as the user `node`, uid 1000. A harness login file is
mode `0600` and owned by your host user. If your host uid is not 1000, the container cannot
read the file through the bind mount, so the login looks absent.

**Fix.** Copy the login into a directory owned by uid 1000 and mount that directory
**read-write** (the harness rewrites tokens). The subscription how-to has the exact commands
and the `id -u` check: https://docs.agenta.ai/self-host/use-your-own-subscription .

## 4. `permission denied ... /var/run/docker.sock`

**Symptom.** A container or `run.sh` fails with `permission denied` on
`/var/run/docker.sock`.

**Cause.** Your user is not in the `docker` group and cannot reach the Docker daemon.

**Fix.** Run as root, use `sudo`, or add yourself to the group and open a new shell:

```bash
sudo usermod -aG docker $USER   # then start a new shell
```

Docker-group membership is root-equivalent on the host. Grant it deliberately.

## 5. Fresh OSS quick start: supertokens fails on an empty `POSTGRESQL_CONNECTION_URI`

**Symptom.** On a first OSS `--gh` deploy, the supertokens container fails to start or
cannot connect to Postgres, and its config shows an empty `POSTGRESQL_CONNECTION_URI`.

**Cause.** The OSS `gh` Compose file maps
`POSTGRESQL_CONNECTION_URI: ${POSTGRES_URI_SUPERTOKENS}` with **no fallback default**, but
the OSS example env file ships `POSTGRES_URI_SUPERTOKENS` **commented out**. So the variable
is empty and supertokens gets no connection string. (The EE Compose file has a `:-...`
fallback, so EE does not hit this.)

**Fix.** Uncomment the line in your OSS env file:

```bash
POSTGRES_URI_SUPERTOKENS=postgresql://username:password@postgres:5432/agenta_oss_supertokens
```

Match the credentials and DB name to your deployment. This is a pending fix in the OSS
example / Compose defaults; treat it as a known gap until the fallback lands upstream.
</content>
