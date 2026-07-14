# Hardening a public-IP deployment

Do this when the host has a public IP or is reachable by anyone but you. A default local
deployment on a private network does not need it. The configuration reference lists every
variable: https://docs.agenta.ai/self-host/configuration .

## 1. Keep Postgres and the Traefik dashboard on loopback

The published Compose ports for Postgres and the Traefik dashboard are bound to `127.0.0.1`:

```yaml
# postgres
- "${POSTGRES_PORT:-127.0.0.1:5432}:5432"
# traefik dashboard
- "127.0.0.1:${TRAEFIK_UI_PORT:-8080}:8080"
```

**As of PR #5308 this loopback bind is the default.** Before that, these ports bound to
`0.0.0.0` and were reachable from the public internet. If you run an older stack, or if you
override `POSTGRES_PORT` / `TRAEFIK_UI_PORT`, confirm they still bind to `127.0.0.1` and not
`0.0.0.0`. Verify with the port check in verify.md.

## 2. Change the default database credentials

The example env files ship `username` / `password` as the Postgres user and password, wired
into the DB URIs (`postgresql://username:password@postgres:5432/...`). Change both before
exposing the host, and update every URI that embeds them (the core DB URIs and the
supertokens URI). Do not leave the defaults on a reachable deployment.

## 3. Generate real secret keys

The example env files ship `AGENTA_AUTH_KEY=replace-me` and `AGENTA_CRYPT_KEY=replace-me`.
Replace both with generated values:

```bash
openssl rand -hex 32   # run once per key
```

Set the results as `AGENTA_AUTH_KEY` and `AGENTA_CRYPT_KEY` in your env file. `AGENTA_CRYPT_KEY`
encrypts stored secrets, so changing it later invalidates anything already encrypted with the
old value. Generate it once, before first use.
</content>
