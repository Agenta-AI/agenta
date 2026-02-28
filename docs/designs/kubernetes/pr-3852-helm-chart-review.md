# PR #3852 — Helm Chart for Agenta OSS: Review

35 files, ~2900 additions. Packages all OSS components (API, web, services, workers, cron,
Redis x2, SuperTokens, PostgreSQL via Bitnami subchart) with Alembic migrations as a
pre-install hook and an optional Ingress.

---

## High Severity (functional bugs / security)

**1. SuperTokens image tag bug** — `supertokens-deployment.yaml` falls back to
`.Chart.AppVersion` (`0.86.8`) when `supertokens.image.tag` is unset. The SuperTokens
registry (`registry.supertokens.io`) almost certainly has no image tagged `0.86.8`. The
container will fail to pull on a fresh install with default values. Needs a hardcoded
default independent of `appVersion`.

**2. `postgresql-auth-secret.yaml` is not a hook** — Unlike `secrets.yaml` (which is a
`pre-install,pre-upgrade` hook), this bridge secret that wires the Bitnami subchart has no
hook annotations and no `helm.sh/resource-policy: keep`. Two problems:
- Helm resource ordering within a wave isn't guaranteed — the Bitnami StatefulSet may start
  before this secret exists
- `helm uninstall` deletes it, so re-installing fails until it's manually recreated

**3. Secrets are overwritten on every `helm upgrade`** — `secrets.yaml` runs as a
`pre-upgrade` hook and blindly writes whatever is in values. Any credential rotated
in-cluster (via `kubectl edit secret`) gets silently reverted on next upgrade. Should use
`lookup` to skip creation if the secret already exists.

---

## Medium Severity (operational)

**4. SuperTokens runs as root** — `supertokens.securityContext` is missing
`runAsNonRoot: true`, unlike every other component (api, web, services, workers, alembic all
have it). Inconsistent and a security gap.

**5. Real PostHog API key hardcoded as default** — `values.yaml` ships with
`posthogApiKey: phc_hmVSxIjTW1REBHXgj2aw4HW9X6CXb6FzerBgP9XenC7`. If this is Agenta's
telemetry key, every self-hosted install sends usage data to it by default with no opt-out
mechanism in the chart. Needs documentation at minimum; an opt-in flag would be better.

**6. Duplicate Redis env var** — `REDIS_URI` and `REDIS_URI_VOLATILE` are both set to the
same value in `commonEnv`. The alias exists for backward compatibility but should be tracked
for removal.

**7. `workflow_dispatch.branches` is silently ignored** — GitHub Actions ignores the
`branches` filter on `workflow_dispatch`. The publish workflow is dispatchable from any
branch, not just `main`.

**8. No chart version bump enforcement in CI** — Publishing the same `version: 0.1.0` to
GHCR's OCI registry silently overwrites the existing artifact.

**9. Cron has no init containers** — Every other backend pod waits for Postgres/Redis to be
ready (via `nc -z` init containers). The cron pod has none. If cron fires a scheduled job
before the DB is ready, it fails silently until next interval.

---

## Low Severity (style / docs)

**10. `$(POSTGRES_PASSWORD)` substitution ordering** — The URI templates embed
`$(POSTGRES_PASSWORD)` as a Kubernetes runtime env var ref. This works because
`POSTGRES_PASSWORD` is declared first in the env list, but the ordering constraint is
implicit and undocumented. Easy to break on refactor.

**11. Worker liveness probes** — `initialDelaySeconds: 15` with no startup probe. Workers
that import heavy dependencies could be killed before they finish starting. Should add a
startup probe.

**12. Web probes hit `/`** — All web probes (`startupProbe`, `livenessProbe`,
`readinessProbe`) hit the root route. A lightweight `/healthz` endpoint would be more
efficient.

**13. `values.schema.json` has no `required` fields** — Schema validation passes with empty
values; the `required` guards are only in the templates. Marking the three mandatory secrets
as required in the schema would enable earlier validation in tools like ArgoCD or IDE
plugins.

**14. `existingSecret` + `oauth`/`llmProviders` interaction undocumented** — If using
`existingSecret`, the user must manually ensure all keys declared under `secrets.oauth` and
`secrets.llmProviders` exist in their secret. Not documented anywhere.

---

## What's Done Well

- Pinned action hashes in CI (good supply chain hygiene)
- `helm.sh/resource-policy: keep` on the main secret (prevents credential loss on
  `helm uninstall`)
- `before-hook-creation` delete policy on the Alembic job (correct for idempotent
  re-upgrades)
- `REDISCLI_AUTH` env var approach for Redis auth in exec probes (avoids password on command
  line)
- `extraObjects` with `tpl` support (clean extensibility mechanism)
- `SCRIPT_NAME` correctly set on API/services for path stripping
- Bitnami subchart vendored as `.tgz` + `--skip-refresh` in CI (reproducible builds)
- PostgreSQL 15+ schema grants handled correctly in `initdb.sql`
