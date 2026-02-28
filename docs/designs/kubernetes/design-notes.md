# Kubernetes Design Notes

Reference notes from analysis of PR #3852 and surrounding design discussions. Topics are
organized by concern, not chronologically.

---

## Postgres Migrations

### How the Migration Runner Works

The Alembic job runs `python -m oss.databases.postgres.migrations.runner`, which executes
four steps sequentially:

1. **`split_core_and_tracing()`** — One-time DB rename/create. Handles upgrade from old
   naming (`agenta_oss` → `agenta_oss_core`, `supertokens_oss` → `agenta_oss_supertokens`).
   For fresh installs, creates the databases if they don't exist. Connects as superuser to
   the `postgres` admin DB. Uses `ALTER DATABASE RENAME` — non-transactional, cannot be
   rolled back.

2. **`migrate_core()`** — Standard `alembic upgrade head` against `agenta_oss_core`.
   Checks `alembic_version` table to detect first-time vs returning user. In Kubernetes,
   `ALEMBIC_AUTO_MIGRATIONS=true` is always set in the job, so migrations always run.

3. **`migrate_tracing()`** — Same logic against `agenta_oss_tracing`.

4. **`copy_nodes_from_core_to_tracing()`** — Copies the `nodes` table via `pg_dump` /
   `pg_restore` / `psql` subprocesses. Requires these binaries in the API image — an
   implicit, unverified dependency. Non-transactional.

Steps 2 and 3 are fully transactional (Postgres DDL is transactional). Steps 1 and 4 are
not.

### Hook Timing Bug

The Alembic job is annotated `post-install,post-upgrade` in the chart, but the PR
description says "pre-install/pre-upgrade". This means migrations run **after** application
pods start:

- Fresh install: API/workers start against empty schema, crash-loop until migration
  completes
- Upgrade: new app version runs against old schema until job finishes

Fix: change to `pre-install,pre-upgrade`.

### Why There Is No Blue-Green

There is no blue-green deployment in this chart. What happens on `helm upgrade`:

```
1. pre-upgrade hooks (secrets)
2. Kubernetes applies Deployment diffs → rolling update starts
3. post-upgrade hooks (Alembic job — wrong order)
```

Kubernetes rolling update with the default `RollingUpdate` strategy is not blue-green.
New pods are added to the Service load balancer as they become Ready. Old pods serve
traffic until terminated. There is no traffic isolation, no Service selector flip, no
green database.

The database names are predefined (`agenta_oss_core`, `agenta_oss_tracing`,
`agenta_oss_supertokens`) and shared by all pods at all times. A true blue-green would
require separate database copies — not implemented.

### Atomicity

Postgres DDL is fully transactional. Every Alembic migration revision runs inside a
`BEGIN`/`COMMIT` block. A mid-migration failure rolls back cleanly — the schema is exactly
as it was before. This is Postgres's advantage over MySQL where DDL is auto-commit.

Exceptions (cannot run in a transaction):
- `CREATE INDEX CONCURRENTLY`
- `CREATE DATABASE` / `ALTER DATABASE RENAME`
- `VACUUM`

Steps 1 and 4 of the runner hit these exceptions. Steps 2 and 3 (standard Alembic) are
safe.

### Shadow Validation Pattern (considered, rejected)

Running pg_dump → restore to shadow DB → migrate shadow → if success, migrate live reduces
risk but doesn't eliminate it. The live DB continues to receive writes during shadow
validation. By the time the shadow test completes, new data may have been written that
violates the migration's assumptions. The shadow test passes; the live migration fails.

To make it safe, you'd need to lock writes during the live run — which reintroduces
downtime anyway.

### Zero-Downtime Migration Options

| Tool | Approach | App changes needed | Rollback |
|---|---|---|---|
| pgroll (Xata, MIT) | Dual views, expand/contract at DB level | Yes — `search_path` per version | Yes |
| pg-osc (MIT) | Shadow table + atomic rename | No — single table name | No (post-rename) |
| Alembic (current) | Direct DDL, no protection | No | Manual reverse migration |

**pgroll** is the most complete implementation of expand/contract. It serves old and new
schema simultaneously as Postgres views, uses triggers to backfill in both directions.
Application must set `search_path` to opt into the new schema version.

**pg-osc** is closer to MySQL's `gh-ost`. Simpler, no dual-schema versioning, but less
atomic overall (multi-step process). Solves lock duration, not atomicity.

For Agenta's current setup, neither is necessary if migrations are written to be
backward-compatible (expand/contract discipline at the application level).

### Expand/Contract and Helm Hook Limitations

With expand/contract assumed, migrations are safe across old/new pods. Remaining Helm hook
limitations:

**1. Two releases, no skip protection** — Expand and contract must be separate releases.
Nothing in Helm prevents skipping the expand release and going straight to contract. A
controller can gate this with status conditions (`ContractAllowed = true` only if
`ExpandComplete = true`).

**2. `--wait` is opt-in** — The contract phase should only run after all pods are on the
new version. `post-upgrade` + `--wait` achieves this, but `--wait` is not the default.
A controller has `--wait` semantics built into the reconciliation loop.

**3. Backfill timeouts** — Large table backfills are bounded by `activeDeadlineSeconds`
(chart default: 600s) and `helm upgrade --timeout` (default: 5 min). No way to tune these
without knowing backfill duration upfront. A controller can decouple the backfill Job from
the upgrade timeout.

**4. No soak period** — No Helm hook fires between "expand complete" and "contract ready".
A controller can implement a timed observation window before advancing state.

---

## GitOps

### ArgoCD vs Flux

**The deciding difference for this chart:**

Flux runs actual `helm upgrade` — hooks, ordering, everything preserved. The Alembic job
works as annotated.

ArgoCD runs `helm template` → `kubectl apply`. It does not call `helm upgrade`. Helm hook
annotations are ignored; ArgoCD uses its own sync wave system
(`argocd.argoproj.io/sync-wave`). The Alembic job becomes a regular Job that runs once on
first deploy and never re-triggers on upgrade.

| Concern | ArgoCD | Flux |
|---|---|---|
| Migration job on upgrade | Broken (hooks ignored) | Works |
| How Helm is applied | `helm template` + `kubectl apply` | actual `helm upgrade` |
| Rollback | Manual or via UI | `helm rollback` via HelmRelease |
| Multi-cluster | Hub-and-spoke, single UI | Per-cluster controllers, no central UI |
| Built-in UI | Yes (strong) | No (Weave GitOps is separate) |
| PR preview environments | Native (ApplicationSet pullRequest generator) | No native support |
| Image automation | External (Argo Image Updater) | Built-in |
| Progressive delivery | Argo Rollouts | Flagger |

**For Agenta:**
- Flux is lower friction given the chart as-is (hooks work)
- ArgoCD is better for PR preview environments (ApplicationSet pullRequest generator is
  built-in; Flux has no equivalent)
- The sync wave fix for ArgoCD is four annotation changes — not a blocker on its own

### GitOps Readiness of PR #3852

What works:
- `secrets.existingSecret` — correct escape hatch for GitOps secret management (external-
  secrets-operator, Sealed Secrets)
- `values.schema.json` — ArgoCD and Flux both validate against it before applying
- `helm.sh/resource-policy: keep` on main secret — prevents pruning from deleting
  credentials
- `extraObjects` with `tpl` — add ArgoCD `AppProject` or Flux `HelmRelease` resources
  inside the chart without forking

What's missing:
- No `Application` manifest for ArgoCD or `HelmRelease` for Flux in the repo
- No ArgoCD sync wave annotations (needed to replace Helm hooks)
- `values.schema.json` has no `required` fields — schema validation passes with empty
  values even though templates will fail
- The ArgoCD hook incompatibility is undocumented

### No Flux Needed With a Controller

Flux's job: watch Git for changes, apply them to the cluster, reconcile drift.

A controller does all of this natively — it watches its own CRD, reconciles continuously,
and desired state lives in the CRD spec rather than a Git-tracked `HelmRelease`. The
continuous reconciliation loop is the GitOps contract.

The only thing lost is Git-as-source-of-truth for audit purposes. Solved with team
discipline: a GitHub Actions workflow that writes CRD specs via `kubectl apply`, with Git
as the authoritative source. No Flux dependency required.

---

## Ephemeral Environments / PR Previews

### Infrastructure Stack

```
Wildcard DNS:  *.preview.agenta.com → ingress controller
cert-manager:  wildcard cert via DNS-01 challenge (one cert covers all subdomains)
ArgoCD:        ApplicationSet with pullRequest generator
Neon:          DB branch per PR (created/deleted via GitHub Actions)
Traefik/nginx: wildcard routing
```

### ArgoCD ApplicationSet

```yaml
generators:
- pullRequest:
    github:
      owner: Agenta-AI
      repo: agenta
      tokenRef:
        secretName: github-token
        key: token
  requeueAfterSeconds: 60
template:
  metadata:
    name: 'agenta-pr-{{number}}'
  spec:
    source:
      targetRevision: '{{head_sha}}'
      path: hosting/helm/agenta-oss
      helm:
        values: |
          global:
            webUrl: "https://pr-{{number}}.preview.agenta.com"
            apiUrl: "https://pr-{{number}}.preview.agenta.com/api"
            servicesUrl: "https://pr-{{number}}.preview.agenta.com/services"
          ingress:
            host: "pr-{{number}}.preview.agenta.com"
    destination:
      namespace: 'agenta-pr-{{number}}'
    syncPolicy:
      automated:
        prune: true
      syncOptions:
        - CreateNamespace=true
```

PR opens → namespace `agenta-pr-123` created, full stack at `pr-123.preview.agenta.com`.
PR closes → ArgoCD prunes everything including PVCs.

### Database Per PR — Neon

Bundled PostgreSQL per PR = one PG StatefulSet + PVC per environment. 10 open PRs = 10
Postgres instances. Heavy and slow to provision.

Neon (serverless Postgres with Git-like branching) is the right solution:
- Branch creation is instant (copy-on-write, no data copied)
- Each PR gets a branch URL
- Branch deleted when PR closes
- Chart already supports this via `postgresql.enabled: false` + external URIs

### Chart Gaps for Ephemeral Environments

| Issue | Impact |
|---|---|
| ArgoCD ignores Helm hooks | Alembic migration never runs — critical |
| No default resource requests/limits | PR envs can starve the cluster |
| No cert-manager annotation by default | Must be added via `ingress.annotations` |
| SuperTokens per PR | Separate auth state per env — users must re-register |
| Redis durable PVC per PR | Same bloat as PG without Neon equivalent |

---

## Controller

### Why a Controller Over Helm + GitOps

Helm hooks and ArgoCD sync waves can sequence operations within a single upgrade. They
cannot:
- Gate deployment rollout on migration success in code (only annotation ordering)
- Prevent skipping expand/contract release steps
- Enforce `--wait` without CI discipline
- Implement a soak period between expand and contract
- Surface rich status conditions on a CRD

A controller moves all of this into code in the reconciliation loop.

### Three Implementation Paths

**Helm Operator (Operator SDK)** — Wraps existing chart in a CRD. Operator watches
`AgentaInstance` CRDs and runs actual `helm upgrade` when spec changes. Hours to working.
Still has hook ordering limits (runs helm upgrade, not custom sequencing). Best as a first
step.

**Kubebuilder (full controller)** — Custom reconciliation loop in Go. Controller calls the
Helm SDK internally (`helm.sh/helm/v3`) to render and apply the chart. Full control over
sequencing. The chart remains the template source. Weeks to build properly.

**Kopf (Python)** — Same logic as Kubebuilder but in Python. More accessible for a
Python-first team. Not the ecosystem standard; harder to hire for.

### Controller Packaging: Helm vs OLM

The controller itself (binary + CRDs + RBAC) needs to be distributed.

| | Helm | OLM | Raw manifests |
|---|---|---|---|
| CRD upgrades | Manual extra step | Automatic | Manual |
| Customization | Full values system | CSV defaults | None |
| OpenShift support | Works | Native | Works |
| OperatorHub listing | No | Yes | No |
| Packaging complexity | Low | High | Minimal |
| Fits existing Agenta setup | Yes | New toolchain | Parallel path |

**Helm is the right call** for consistency with the existing chart. The CRD upgrade
limitation is real but solvable with a pre-upgrade hook that applies CRDs.

OLM becomes worth the investment if Agenta targets OperatorHub or OpenShift customers.
Projects typically ship both (cert-manager does this). The controller code is the same
either way — packaging is a separate concern.

### CRD Design

```yaml
apiVersion: agenta.ai/v1alpha1
kind: AgentaInstance
metadata:
  name: production
spec:
  version: "0.86.8"
  domain: "agenta.example.com"
  database:
    type: external       # or bundled
    neonBranchUrl: "..."
  replicas:
    api: 2
    web: 1
status:
  phase: Running
  observedVersion: "0.86.8"
  conditions:
    - type: MigrationComplete
      status: "True"
    - type: AppReady
      status: "True"
```

### Reconciliation Loop (core logic)

```go
func (r *Reconciler) reconcile(ctx context.Context, instance *v1alpha1.AgentaInstance) error {
    // Gate on migration — expressed in code, not hook ordering
    if instance.Status.ObservedVersion != instance.Spec.Version {
        if err := r.runMigration(ctx, instance); err != nil {
            r.setCondition(instance, "MigrationFailed", ...)
            return err  // stop, old pods keep serving
        }
        if !r.migrationComplete(ctx, instance) {
            return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
        }
    }

    // Helm upgrade against chart from GHCR
    chart, _ := loader.LoadOCI("ghcr.io/agenta-ai/helm-charts/agenta-oss", instance.Spec.Version)
    upgrade := action.NewUpgrade(r.helmConfigFor(instance.Namespace))
    upgrade.Wait = true
    _, err := upgrade.Run(instance.Name, chart, instance.Spec.ToValues())
    return err
}
```

### Progression Summary

```
Raw Helm          → CLI-driven, manual
  + ArgoCD        → GitOps, UI, drift detection, PR previews via ApplicationSet
  + Controller    → sequencing in code, CRD-driven lifecycle, --wait enforced
  - ArgoCD        → controller IS the reconciliation loop (keep ArgoCD only for UI)
```

End states:
- **Controller only** — lean, self-contained, CRD-driven
- **Controller + ArgoCD UI** — same lifecycle, visual graph of every resource across clusters
