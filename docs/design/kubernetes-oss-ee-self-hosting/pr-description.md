# Deployment artifacts refresh for v0.100.2 (helm + compose + env)

## Why this PR exists

The deployment artifacts (Helm chart, docker-compose, env files) had drifted from the actual application config surface defined in `api/oss/src/utils/env.py`. The drift made every self-host upgrade harder than it should be: variable names didn't match between the three surfaces, several knobs existed in env.py but not in the chart, the chart used Kubernetes-flavored groupings (`secrets.*`, `accessControl.*`, `email.*`) that an Agenta operator had no prior context for, and the example values files contained stale and partially-empty placeholders. This PR resolves that drift in one pass, lands a self-contained chart at `hosting/kubernetes/helm/`, and ships a written migration path from pre-v0.100.2 deployments.

## Non-breaking by construction

Every renamed environment variable retains its **legacy name as a fallback** in `api/oss/src/utils/env.py`. The Pydantic loader reads the new name first, falls back to the old, so existing deployments keep working without setting anything new. Helm `values.yaml` key reshape **is** a breaking change for users upgrading the chart (no way to alias YAML paths), and that's exactly what the migration guide at `docs/docs/self-host/upgrades/v0.100.2-migration.mdx` walks through, with a step-by-step rewrite procedure that's been QA'd end-to-end on a live cluster (see `docs/design/kubernetes-oss-ee-self-hosting/qa-plan.md`). The QA exercised: install from v0.100.1 → snapshot values → `git checkout` to this branch → translate values → `helm upgrade` → verify pods, PVCs, alembic, ingress, and the new `defaultPlanOverlay` knob all survived; no data loss, same auth keys, same crypt key, same Postgres password.

## 1. Canonical config mapping (`hosting/kubernetes/CONFIG_MAPPING.md`)

The whole refactor hangs off a single source of truth: a three-column table mapping every environment variable to its `env.py` attribute path and its `values.yaml` path, with legacy names struck through where they were renamed. Naming rule: `AGENTA_<GROUP>_<FIELD>` ↔ `env.<group>.<field>` ↔ `<group>.<field>` (helm). Exceptions for `identity.*` (no `AGENTA_` prefix because they're OIDC provider names like `GOOGLE_*`) and `llm.*` (same reason). This file is referenced from every doc that touches deployment config and is intended to stay as the canonical mapping going forward.

## 2. `api/oss/src/utils/env.py` reshape (with legacy aliases)

`env.py` is regrouped to match `CONFIG_MAPPING.md`: top-level sections `agenta.{access,aiServices,api,billing,extras,logging,otlp,services,webhooks}`, plus `alembic`, `cloudflare.turnstile`, `identity.<provider>`, `llm`, `postgres`, `redis`, `sendgrid`, `stripe`, `supertokens`, `newrelic`, etc. Every renamed field reads `os.getenv("NEW") or os.getenv("LEGACY")` so old env vars still resolve. Major renames (full list in `CONFIG_MAPPING.md` deprecation table): `AGENTA_ALLOWED_DOMAINS` → `AGENTA_ACCESS_ALLOWED_DOMAINS`, `AGENTA_DEMOS` → `AGENTA_EXTRAS_DEMOS`, `AGENTA_LOG_*` → `AGENTA_LOGGING_*`, `AGENTA_CACHE_ENABLED` → `AGENTA_API_CACHING_ENABLED`, `AGENTA_WEBHOOK_ALLOW_INSECURE` → `AGENTA_WEBHOOKS_ALLOW_INSECURE` (API side) / `AGENTA_SERVICES_HOOK_ALLOW_INSECURE` (SDK side), `SUPERTOKENS_CONNECTION_URI` → `SUPERTOKENS_URI_CORE`, `SUPERTOKENS_EMAIL_DISABLED` → `AGENTA_ACCESS_EMAIL_DISABLED`, `POSTHOG_HOST` → `POSTHOG_API_URL`, `STRIPE_TARGET` → `STRIPE_WEBHOOK_TARGET`, `NEW_RELIC_LICENSE_KEY` → `NEWRELIC_LICENSE_KEY`, `ACTIVE_DIRECTORY_OAUTH_*` → `AZURE_AD_OAUTH_*`. Removed (was unused): `AGENTA_RUNTIME_PREFIX`. All API/EE/SDK consumers updated to the new attribute paths.

## 3. Helm chart relocation: `hosting/helm/agenta-oss/` → `hosting/kubernetes/helm/`

The chart is now self-contained at `hosting/kubernetes/helm/` (publishable as-is to a Helm repo), with edition-specific **example** values living outside the chart at `hosting/kubernetes/{oss,ee}/values.{oss,ee}.example.yaml`. The chart's own `values.yaml` mirrors only the docker-compose env surface (the irreducible set of values an operator must provide); everything else — image repositories, ports, replicas, resource requests, ingress wiring, postgresql/redis subchart knobs — is supplied by templates and helpers via `default` fallbacks. This makes the chart lint cleanly standalone and means the example files don't have to repeat platform plumbing.

## 4. Helm chart key reshape (`values.yaml` keys regrouped by domain)

Where pre-v0.100.2 used Kubernetes-flavored groupings (`global.*` for license + URLs, `secrets.*` for everything secret-shaped, `accessControl.*`, `email.*`, `integrations.*`, `observability.*`, `captcha.*`), v0.100.2 groups by **domain**: `agenta.{license,webUrl,apiUrl,servicesUrl,authKey,cryptKey}`, `agenta.access.*`, `identity.<provider>.*`, `llm.*`, `postgres.*`, `sendgrid.*`, `composio.*`, `newrelic.*`, `cloudflare.turnstile.*`. An operator who knows the env vars now recognizes the yaml on sight (the three surfaces encode the same nesting). The migration guide has the full reshape table; the canonical mapping is in `CONFIG_MAPPING.md`. This is the part that **breaks** YAML compatibility (no aliasing possible) — the migration guide is the one-time upgrade path.

## 5. Helm templates: `_helpers.tpl` rewrite + per-template conventions

Templates were rewritten to use `{{- $values := default dict .Values -}}` at the top, plus same-named per-group locals (`$api`, `$web`, `$ingress`, `$newrelic`, etc.) rooted in `$values`. This makes every template nil-safe without sprinkling `default dict` everywhere in template bodies. `_helpers.tpl` consolidates env-var rendering: a single `commonEnv` helper inlines what used to be split across `commonEnv` + `backendOptionalEnv`. The `redis-durable-statefulset.yaml` template defaults persistence to `true` via `default true $persistence.enabled` (QA caught this — without it, the upgrade fails because `volumeClaimTemplates` is an immutable StatefulSet field, and v0.100.1 had persistence enabled by default). The chart's `values.yaml` also pins `postgresql.primary.persistence.size: "10Gi"` so the Bitnami subchart's default never floats (also caught by QA — same immutable-field failure mode otherwise).

## 6. Example values files (`hosting/kubernetes/{oss,ee}/values.{oss,ee}.example.yaml`)

Two example files, one per edition. License + endpoints + secrets uncommented (essentials operators must edit); everything else commented with sample values, no empty placeholders. Section order: License → Images → Endpoints → Secrets → rest alphabetical. The Traefik StripPrefix middleware setup discovered during QA is shown (commented out) under `ingress.annotations` + `extraObjects` so future readers find the pattern. Postgres PVC size and redis-durable persistence are also shown (commented) under their respective sections.

## 7. Docker-compose env files + compose files

`hosting/docker-compose/{oss,ee}/env.{oss,ee}.{dev,gh}.example` regenerated with the same canonical mapping: ordering License → Images (commented) → Endpoints → Secrets → rest alphabetical → deprecated block at bottom. Variable names match `env.py` and `values.yaml` exactly (legacy names still loaded as fallbacks, listed in the deprecation block). Compose files themselves bumped/pinned to current images.

## 8. Run scripts

`hosting/docker-compose/run.sh` and a new `hosting/kubernetes/run.sh` share a near-identical CLI surface (`--oss`/`--ee`, `--nuke`, `--wait`, `--env`/`--values`, etc.) so an operator can switch between compose and helm without relearning flags. Helm's run.sh wraps the common `helm upgrade --install` invocation against the new chart paths.

## 9. Migration guide (`docs/docs/self-host/upgrades/v0.100.2-migration.mdx`)

New page. Three reshape tables (chart folder relocation, `values.yaml` key reshape, env-var renames with legacy aliases), seven-step migration procedure with concrete commands including `helm get values` snapshot and a `kubectl`-only fallback for unwrapping the release Secret when helm isn't available. Includes a worked example for translating `accessControl.plans` → `agenta.access.plans`, OAuth `secrets.oauth.*` → `identity.<provider>.*`, and `llmProviders.*` → `llm.*`. Calls out the new `agenta.access.defaultPlanOverlay` v0.100.2 feature with a usage snippet (live-verified during QA: round-trips YAML → ConfigMap → pod env intact). The "Verify" step uses the actual resource names the chart emits (`job/agenta-agenta-oss-alembic`, ingress-based curl) and warns about the expected Alembic Job retry pattern during the Postgres StatefulSet roll.

## 10. Install + upgrade guides (`docs/docs/self-host/guides/03-deploy-to-kubernetes.mdx`, `docs/docs/self-host/03-upgrading.mdx`)

Install guide updated to v0.100.2 values paths (`agenta.authKey`, `postgres.password`, `agenta.webUrl`, etc.) and gains an explicit ingress prerequisite plus a local-testing Traefik recipe (Traefik v3 + `/etc/hosts` + port-forward) — without it, new operators following the Quick Start with EE values discover the hard way that a single port-forward can't satisfy path-based routing. `openssl rand` snippet added for the EE path (the OSS path had one, EE didn't). Troubleshooting section's secret-path references updated. Upgrade page links to the v0.100.2 migration callout.

## 11. Configuration reference (`docs/docs/self-host/02-configuration.mdx`)

Rewritten as per-section three-column tables (env var | env.py path | values.yaml path) matching `CONFIG_MAPPING.md`. Deprecated variables collected in a single table at the bottom with their canonical replacements. Replaces the previous mix of prose + inconsistent partial tables.

## 12. CI/release workflows

`.github/workflows/01-create-release-branch.yml` also bumps the Helm chart version when cutting a release branch (Helm chart `version` and `appVersion` now stay in lockstep with API/SDK/web versions). The standalone application-side `.github/workflows/09-helm-publish.yml` is removed — Helm publishing moves to the platform-side `41-release-to-public.yml` chain so it runs off the same release branch as PyPI and GHCR publishes. (Platform-side workflow change lives in the platform repo.)

## 13. Cleanups (dead code, generated artifacts)

`hosting/old/{aws,gcp}/` Terraform left over from an abandoned cloud-hosting attempt is removed (verified unreferenced). `hosting/docker-compose/tmp/*.override.yml` left over from local debugging is removed. `sdks/typescript/.gitkeep` removed (the directory has real content now). The old `hosting/helm/agenta-oss/` chart directory is removed; the new chart lives at `hosting/kubernetes/helm/`.

## 14. SDK runtime hooks (`sdks/python/agenta/sdk/engines/running/handlers.py`)

The SDK reads `AGENTA_SERVICES_HOOK_ALLOW_INSECURE` first, falling back to `AGENTA_WEBHOOK_ALLOW_INSECURE`. The rename clarifies that this flag governs SDK-side workflow hooks (which talk to user code), not API-side webhooks (which the API delivers outward). Both names work; the legacy form is documented as deprecated.

## 15. Misc API touch-ups for the env reshape

`api/ee/src/core/meters/types.py` inlines `AGENTA_METERS_NAMESPACE_UUID` (previously `env.agenta.uuid_namespace`, a static computed value — moving it to a module constant removes a config knob that operators couldn't meaningfully set). EE controls test (`test_controls_env_override.py`) updated for the new `AGENTA_ACCESS_*` env-var names. Supertokens config reads `SUPERTOKENS_URI_CORE` with `SUPERTOKENS_CONNECTION_URI` fallback. Auth/turnstile/webhooks/caching/logging modules updated to read from the new `env.agenta.*` attribute paths.

## QA evidence

`docs/design/kubernetes-oss-ee-self-hosting/qa-plan.md` captures the live cluster QA: install pre-v0.100.2 (`v0.100.1` EE tag) → create data → snapshot values → checkout this branch → translate values → `helm upgrade` → verify. Caught (and fixed in this PR) two chart regressions: missing postgres PVC size pin and missing redis-durable persistence default. Plus six doc-gaps in the migration guide and install guide (wrong Job/Service names, missing ingress prerequisite, stale values paths) — all listed at the bottom of qa-plan.md with FIXED/NOT-FIXED status and file paths.

## Risk assessment

- **App config drift** (env.py legacy aliases): low. Pydantic loader prefers new names, falls back to old. Existing deployments work without touching anything.
- **Helm values YAML reshape**: medium. No way to alias YAML paths; users must rewrite their values file once per the migration guide. Mitigated by the migration guide and the QA-validated step-by-step procedure with data preservation.
- **Chart resource naming**: unchanged (`agenta-agenta-oss-*` still). No StatefulSet/Service renames; existing in-cluster references continue to work.
- **PVC preservation across upgrade**: validated live (10Gi postgres + 5Gi redis-durable PVCs survive `helm upgrade` from v0.100.1 to v0.100.2 with the fixes in this PR).
- **Image tag bump only changes binaries**: separate from the chart/values changes. The migration guide tells operators to bump tags as part of the values translation; they can also bump tags without the values reshape if they pin to a v0.100.x ≥ .2 release that includes both.

## What's in scope vs out

- **In scope**: env config canonicalization, helm chart relocation + reshape, docker-compose env files, migration guide, install/upgrade docs, run scripts, removal of unused legacy code under `hosting/old/`.
- **Out of scope** (not in this PR): the platform-side `41-release-to-public.yml` workflow change that adds Helm publishing — lives in the platform repo. Templated service deployments (chart only provisions the services gateway, not the per-template service deployments) — same as v0.100.1 behavior, not introduced or changed here.
