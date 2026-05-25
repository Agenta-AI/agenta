# QA Plan — Pre-v0.100.2 → v0.100.2 Helm Migration

Goal: deploy from `main` (pre-v0.100.2), then migrate to this branch (`chore/update-deployment-artifacts`) using the published migration guide, and confirm the deployment still works.

You will need an EE image tag that already exists on GHCR. Substitute `<EE_TAG>` everywhere below.

---

## 0. Prereqs

Local tools:
- `git`, `helm` (v3), `kubectl`, a running k8s cluster (kind / minikube / Docker Desktop / cloud)
- A GHCR pull secret in the target namespace (named `ghcr-pull-secret` by convention)

Pick a namespace and stick with it:

```bash
export NS=agenta-qa
kubectl create namespace $NS
```

Create the GHCR pull secret (skip if you already have one in `$NS`):

```bash
kubectl -n $NS create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<github-pat-with-read:packages>
```

---

## Phase 1 — Install from `main` (the "before" state)

### 1.1 Check out main into a scratch worktree

```bash
cd /Users/junaway/Agenta/github/application
git fetch origin main
git worktree add /tmp/agenta-main origin/main
cd /tmp/agenta-main
```

### 1.2 Copy the EE example values file

```bash
cp hosting/helm/agenta-oss/values-ee.example.yaml /tmp/values-pre.yaml
```

### 1.3 Edit `/tmp/values-pre.yaml`

Set the bare minimum to make it reachable and use your EE image:

```yaml
global:
  agentaLicense: ee
  webUrl: "http://localhost"
  apiUrl: "http://localhost/api"
  servicesUrl: "http://localhost/services"
  imagePullSecrets:
    - name: ghcr-pull-secret

secrets:
  agentaAuthKey: "qa-auth-key"
  agentaCryptKey: "qa-crypt-key"
  postgresPassword: "qa-postgres-password"

ingress:
  enabled: true
  className: "traefik"   # or whatever your cluster runs
  host: "localhost"

api:
  image:
    tag: "<EE_TAG>"
web:
  image:
    tag: "<EE_TAG>"
services:
  image:
    tag: "<EE_TAG>"
```

### 1.4 Install

```bash
cd /tmp/agenta-main
helm dependency update hosting/helm/agenta-oss
helm -n $NS upgrade --install agenta hosting/helm/agenta-oss \
  -f /tmp/values-pre.yaml \
  --wait --timeout 10m
```

### 1.5 Verify the "before" deployment

```bash
kubectl -n $NS get pods
kubectl -n $NS get svc
helm -n $NS list
```

Smoke test (port-forward + curl, or hit your ingress):

```bash
kubectl -n $NS port-forward svc/agenta-web 8080:3000 &
curl -fsS http://localhost:8080/ >/dev/null && echo "web OK"
kubectl -n $NS port-forward svc/agenta-api 8081:8000 &
curl -fsS http://localhost:8081/api/health >/dev/null && echo "api OK"
```

Stop the port-forwards before the next phase:

```bash
kill %1 %2 2>/dev/null || true
```

---

## Phase 2 — Capture the pre-migration state

Before touching anything, snapshot the values Helm currently holds:

```bash
helm -n $NS get values agenta -o yaml > /tmp/pre-v0.100.2-values.yaml
cat /tmp/pre-v0.100.2-values.yaml
```

If you used `--set` flags (you didn't here, but in a real upgrade you might), and `helm get values` shows blanks, fall back to the release Secret:

```bash
REV=$(helm -n $NS list -o json | jq -r '.[] | select(.name=="agenta") | .revision')
kubectl -n $NS get secret sh.helm.release.v1.agenta.v$REV \
  -o jsonpath='{.data.release}' \
  | base64 -d | base64 -d | gunzip \
  | jq -r '.config'
```

---

## Phase 3 — Migrate to v0.100.2 (this branch)

### 3.1 Switch to this branch's hosting/

```bash
cd /Users/junaway/Agenta/github/application
git checkout chore/update-deployment-artifacts
```

### 3.2 Open the migration guide and follow it

```bash
open docs/docs/self-host/upgrades/v0.100.2-migration.mdx
```

Work through it in order. The condensed version of what it asks you to do:

1. **Translate keys.** Copy `hosting/kubernetes/ee/values.ee.example.yaml` to `/tmp/values-post.yaml`. Open `/tmp/pre-v0.100.2-values.yaml` side-by-side and rewrite each value into the new shape using the reshape tables in the migration guide. Key moves to expect:
   - `global.agentaLicense` → `agenta.license`
   - `global.webUrl|apiUrl|servicesUrl` → `agenta.webUrl|apiUrl|servicesUrl`
   - `global.imagePullSecrets` → stays at `global.imagePullSecrets` (EE only)
   - `secrets.agentaAuthKey` → `agenta.authKey`
   - `secrets.agentaCryptKey` → `agenta.cryptKey`
   - `secrets.postgresPassword` → `postgres.password`
   - `api|web|services.image.tag` → still `api|web|services.image.tag`
   - `ingress.*` → still `ingress.*`
2. **Set image tag.** Use the same `<EE_TAG>` for `api`, `web`, `services`.
3. **Leave Postgres data alone.** Do NOT change the postgres password or persistence settings — they must match what's already in the cluster.

### 3.3 Upgrade in place

```bash
cd /Users/junaway/Agenta/github/application
helm dependency update hosting/kubernetes/helm
helm -n $NS upgrade agenta hosting/kubernetes/helm \
  -f /tmp/values-post.yaml \
  --wait --timeout 10m
```

If the migration guide says to delete a resource first (e.g. a renamed Secret with a stale label selector), do that exact step before `helm upgrade`.

---

## Phase 4 — Verify the "after" state

### 4.1 Pods and revision

```bash
helm -n $NS list                 # revision should have bumped, status Deployed
kubectl -n $NS get pods          # all Running, no CrashLoopBackOff
kubectl -n $NS rollout status deploy/agenta-api
kubectl -n $NS rollout status deploy/agenta-web
kubectl -n $NS rollout status deploy/agenta-services
```

### 4.2 Same smoke test as before

```bash
kubectl -n $NS port-forward svc/agenta-web 8080:3000 &
curl -fsS http://localhost:8080/ >/dev/null && echo "web OK"
kubectl -n $NS port-forward svc/agenta-api 8081:8000 &
curl -fsS http://localhost:8081/api/health >/dev/null && echo "api OK"
kill %1 %2 2>/dev/null || true
```

### 4.3 Data preserved

The Postgres PVC should be unchanged across the upgrade. Confirm by checking that any account/data you created in Phase 1.5 is still visible after Phase 4.2 (log in via the web UI; existing user from before should still authenticate).

### 4.4 Logs are clean

```bash
kubectl -n $NS logs deploy/agenta-api --tail=200 | grep -iE "error|exception|traceback" || echo "api log clean"
kubectl -n $NS logs deploy/agenta-web --tail=200 | grep -iE "error|exception" || echo "web log clean"
```

---

## Phase 5 — Pass / Fail criteria

PASS if all of these hold:
- `helm list` shows the release as `deployed` on a new revision
- All pods `Running`, none in `CrashLoopBackOff` or `ImagePullBackOff`
- `/` and `/api/health` return 200 after the upgrade
- A user created in Phase 1.5 can still log in after Phase 4
- No new errors in api/web logs that weren't present pre-migration

FAIL → capture and attach:
- `helm -n $NS history agenta`
- `kubectl -n $NS get events --sort-by=.lastTimestamp | tail -30`
- `kubectl -n $NS describe pod <failing-pod>`
- `kubectl -n $NS logs <failing-pod> --previous`
- Your `/tmp/pre-v0.100.2-values.yaml` and `/tmp/values-post.yaml`

---

## Cleanup

```bash
helm -n $NS uninstall agenta
kubectl delete namespace $NS
git worktree remove /tmp/agenta-main
rm -f /tmp/values-pre.yaml /tmp/values-post.yaml /tmp/pre-v0.100.2-values.yaml
```
