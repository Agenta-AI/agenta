# WP4 — Cron wiring (infra; fully independent)

Read `contracts.md` first. Independent of the api-core WPs — only needs the endpoint URL from WP3
(`/admin/triggers/schedules/refresh`).

## Files
- NEW `api/oss/src/crons/triggers.sh`
- NEW `api/oss/src/crons/triggers.txt`
- `api/oss/docker/Dockerfile.dev`
- `api/oss/docker/Dockerfile` (the gh/prod one — confirm exact path)
- `hosting/docker-compose/oss/docker-compose.dev.yml` (cron service volume mount)
- `hosting/docker-compose/ee/docker-compose.dev.yml` (cron service volume mount)
- `api/pyproject.toml` (add `croniter`)

## triggers.sh
Mirror `api/oss/src/crons/queries.sh` exactly, but POST to the schedules refresh endpoint:
```sh
"http://api:8000/admin/triggers/schedules/refresh?trigger_interval=${TRIGGER_INTERVAL}&trigger_datetime=${TRIGGER_DATETIME}"
```
Keep the same `TRIGGER_INTERVAL` extraction from `/app/crontab`, the same rounded-minute
`TRIGGER_DATETIME` computation, and the `Authorization: Access ${AGENTA_AUTH_KEY}` header.
Change the `awk` pattern to match `triggers\.sh`.

## triggers.txt
Mirror `queries.txt` — every minute:
```
* * * * * root sh /triggers.sh >> /proc/1/fd/1 2>&1
```

## Dockerfiles
In both OSS Dockerfiles, copy `triggers.sh` → `/triggers.sh` and `triggers.txt` →
`/etc/cron.d/triggers-cron`, then ADD both to the chmod/sed crontab-build pipeline exactly like
`queries-cron` (see `Dockerfile.dev:62-70` pattern: chmod, sed `$a\`, strip `root`, strip the
`>> /proc/1/fd/1` redirect, concat into `/app/crontab`).

## docker-compose (dev, both editions)
The `cron` service mounts each `.sh`. Add:
```yaml
- ../../../api/oss/src/crons/triggers.sh:/triggers.sh
```
to the `cron` service `volumes:` in both `oss/docker-compose.dev.yml` and `ee/docker-compose.dev.yml`
(EE's cron already mounts queries.sh + meters/spans/events.sh).

## pyproject.toml
Add `croniter` to `api/pyproject.toml` base dependencies (used by WP3 validation + refresh, runs in
api + cron + worker images). Pure-Python, no native build.

## AC
- After rebuild, the `cron` container fires `/admin/triggers/schedules/refresh` every minute (visible
  in `docker logs`).
- `croniter` importable in the api image.

## Notes / open
- Confirm the exact prod Dockerfile path (`api/oss/docker/Dockerfile` vs `.gh`); the dev one is
  authoritative for local verification.
- Schedules are OSS-only but the cron mechanism is shared; mounting in the EE compose cron is correct
  because EE runs the OSS routers too.
