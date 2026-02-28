# Helm to Controller: Incremental Progression

Full progression as concrete repo structure and artifacts. Nothing is thrown away at each
step. The `agenta-oss` chart is the foundation throughout — modified once at step 1, then
consumed as a versioned artifact from GHCR by everything that follows.

---

## Step 1 — Raw Helm (fix what's broken)

Before adding anything, fix the chart issues from the review. Everything else builds on
this.

```
hosting/helm/agenta-oss/     ← instance chart, fixed
```

Fixes in order:
1. `alembic-job.yaml`: `post-install,post-upgrade` → `pre-install,pre-upgrade`
2. `supertokens-deployment.yaml`: hardcode default image tag, don't fall back to
   `.Chart.AppVersion`
3. `postgresql-auth-secret.yaml`: add hook annotations + `resource-policy: keep`
4. `secrets.yaml`: add `lookup` guard to skip overwrite if secret exists

CI already publishes the chart to GHCR — that's the distribution mechanism for all
subsequent steps.

---

## Step 2 — Add ArgoCD

Chart is **untouched**. GitOps manifests are added alongside it.

```
hosting/helm/agenta-oss/          ← unchanged
hosting/gitops/
  argocd/
    application.yaml              ← single install pointing at chart
    applicationset-previews.yaml  ← PR previews via pullRequest generator
```

```yaml
# applicationset-previews.yaml
generators:
- pullRequest:
    github:
      owner: Agenta-AI
      repo: agenta
  requeueAfterSeconds: 60
template:
  spec:
    source:
      path: hosting/helm/agenta-oss
      helm:
        values: |
          global:
            webUrl: "https://pr-{{number}}.preview.agenta.com"
          ingress:
            host: "pr-{{number}}.preview.agenta.com"
    destination:
      namespace: agenta-pr-{{number}}
    syncPolicy:
      automated:
        prune: true
      syncOptions:
        - CreateNamespace=true
```

Also add ArgoCD sync wave annotations to `alembic-job.yaml` (ArgoCD ignores Helm hooks,
uses its own system):

```yaml
# alembic-job.yaml — add alongside existing helm.sh/hook annotations
argocd.argoproj.io/hook: PreSync
argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
argocd.argoproj.io/sync-wave: "-1"
```

---

## Step 3 — Add Controller

Two new things appear. Nothing existing changes.

```
hosting/helm/agenta-oss/              ← still unchanged, consumed internally by controller
hosting/helm/agenta-controller/       ← NEW: installs the controller
  Chart.yaml
  values.yaml
  templates/
    crds/
      agentainstance.yaml             ← AgentaInstance CRD
    deployment.yaml                   ← controller binary
    clusterrole.yaml                  ← RBAC to manage all agenta-oss resources
    clusterrolebinding.yaml
    serviceaccount.yaml
    pre-upgrade-crds-hook.yaml        ← applies CRDs before helm upgrade (CRD upgrade workaround)

controller/                           ← NEW: Go controller code
  main.go
  api/v1alpha1/
    agentainstance_types.go           ← CRD spec/status structs
  internal/controllers/
    agentainstance_controller.go      ← reconciliation loop

hosting/gitops/
  argocd/
    application.yaml                  ← UPDATED: now watches AgentaInstance CRDs
    applicationset-previews.yaml      ← UPDATED: creates AgentaInstance instead of
                                         rendering chart directly
```

The controller pulls the `agenta-oss` chart from GHCR (where CI already publishes it) and
calls the Helm SDK internally:

```go
func (r *Reconciler) reconcile(ctx context.Context, instance *v1alpha1.AgentaInstance) error {
    // 1. Migration gate — what hooks can't express across releases
    if instance.Status.ObservedVersion != instance.Spec.Version {
        if err := r.runMigration(ctx, instance); err != nil {
            return err  // sets MigrationFailed condition, stops here
        }
        if !r.migrationComplete(ctx, instance) {
            return ctrl.Result{RequeueAfter: 5 * time.Second}, nil
        }
    }

    // 2. Helm upgrade — chart pulled from GHCR
    chart, _ := loader.LoadOCI("ghcr.io/agenta-ai/helm-charts/agenta-oss", instance.Spec.Version)
    upgrade := action.NewUpgrade(r.helmConfigFor(instance.Namespace))
    upgrade.Wait = true  // enforced in code, not CI discipline
    _, err := upgrade.Run(instance.Name, chart, instance.Spec.ToValues())
    return err
}
```

The ApplicationSet now creates `AgentaInstance` CRD instances instead of rendering the
chart directly:

```yaml
# applicationset-previews.yaml — updated
template:
  spec:
    source:
      path: hosting/gitops/instances/preview-template.yaml
```

```yaml
# preview-template.yaml
apiVersion: agenta.ai/v1alpha1
kind: AgentaInstance
metadata:
  name: pr-{{number}}
spec:
  version: "{{head_sha}}"
  domain: "pr-{{number}}.preview.agenta.com"
  database:
    neonBranchUrl: "{{neon_branch_url}}"
```

---

## Step 4 — Drop ArgoCD (optional)

```
hosting/gitops/argocd/    ← deleted (or kept for UI only)
```

GitHub Actions replaces the ApplicationSet for ephemeral environments:

```yaml
# .github/workflows/preview.yml
- name: Create preview environment
  run: |
    NEON_URL=$(curl -X POST api.neon.tech/branches \
      -d "{\"name\": \"pr-${{ github.event.number }}\"}" | jq -r '.connection_uri')
    kubectl apply -f - <<EOF
    apiVersion: agenta.ai/v1alpha1
    kind: AgentaInstance
    metadata:
      name: pr-${{ github.event.number }}
    spec:
      version: "${{ github.sha }}"
      domain: "pr-${{ github.event.number }}.preview.agenta.com"
      database:
        neonBranchUrl: "$NEON_URL"
    EOF

- name: Destroy preview environment
  if: github.event.action == 'closed'
  run: kubectl delete agentainstance pr-${{ github.event.number }}
```

---

## What Each Step Adds vs Changes

| Step | Added | Changed | Deleted |
|---|---|---|---|
| 1 Fix Helm | — | 4 files in chart | — |
| 2 ArgoCD | `hosting/gitops/argocd/` | 1 file in chart (sync waves) | — |
| 3 Controller | `hosting/helm/agenta-controller/`, `controller/` | `applicationset-previews.yaml` | — |
| 4 Drop ArgoCD | GitHub Actions workflow | — | `hosting/gitops/argocd/` |

The `agenta-oss` chart is modified once (step 1 fixes + step 2 sync wave annotations) and
then **never touched again**. The controller consumes it as a versioned OCI artifact from
GHCR.

---

## Why No Throwaway

Each step is purely additive:
- The Helm chart is the base artifact at every stage
- ArgoCD at step 2 adds manifests, changes nothing in the chart
- The controller at step 3 wraps the chart via Helm SDK, doesn't replace it
- Dropping ArgoCD at step 4 removes one YAML directory, nothing structural

The only genuine throwaway at any point is the ArgoCD `Application` manifest (a ~30-line
YAML) if ArgoCD is dropped — not infrastructure.
