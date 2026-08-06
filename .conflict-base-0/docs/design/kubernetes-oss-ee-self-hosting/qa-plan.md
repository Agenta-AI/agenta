# QA Plan — Pre-v0.100.3 → v0.100.3 Helm Migration

Goal: install Agenta on Kubernetes by following the **pre-v0.100.3 install docs verbatim**, then follow the **v0.100.3 migration docs verbatim**, and confirm the deployment still works.

You clone the repo once, deploy from `main`, then `git checkout` the v0.100.3 branch in the same checkout and run the upgrade — exactly what a real operator does. All paths below are relative to the clone root (`agenta/`); the snapshot file is written one level up so it survives the `git checkout`.

You will need two EE image tags that exist on `ghcr.io/agenta-ai/internal-ee-*`:

- `OLD_EE_TAG` — any **pre-v0.100.3** EE tag (this is the "already running" deployment).
- `NEW_EE_TAG` — the **v0.100.3** EE tag being validated.

You will also need a GitHub PAT with `read:packages` on the EE org.

> Everything in this plan comes from the published docs. Lines marked **[QA-only]** are testing-harness additions (e.g. picking which tag to use); lines marked **[doc-gap]** are places where I had to fill in a step that the public docs do not actually tell the user, and the doc should be fixed.

---

## Phase 0 — Pick a clean starting state

From the directory you want to keep the clone in:

```bash
git clone https://github.com/Agenta-AI/agenta
cd agenta
git checkout main
```

Pick the tags and credentials to test with:

```bash
export OLD_EE_TAG=<pre-v0.100.3 tag>    # [QA-only] used in Phase 1
export NEW_EE_TAG=<v0.100.3 tag>        # [QA-only] used in Phase 3
export GH_USER=<your-gh-user>           # [QA-only]
export GH_PAT=<your-read-packages-pat>  # [QA-only]
```

---

## Phase 1 — Install from pre-v0.100.3 docs (Enterprise Edition)

**Source:** `docs/docs/self-host/guides/03-deploy-to-kubernetes.mdx` on `main`, section _Deploy Enterprise Edition_.

### 1.0 Install a Traefik ingress controller (local, no DNS)

The chart creates an `Ingress` with path routing (`/`, `/api`, `/services`) and defaults `ingress.className: traefik`. The docs reference `apiVersion: traefik.io/v1alpha1` for the StripPrefix middleware, which is the **Traefik v3** CRD group — that's what the current `traefik/traefik` Helm chart installs by default.

Install Traefik v3 once per cluster:

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm install traefik traefik/traefik \
  --namespace traefik --create-namespace \
  --set ingressClass.name=traefik
```

Since this is a local cluster with no DNS, use `/etc/hosts` to point the example hostname at localhost:

```bash
echo "127.0.0.1 agenta.example.com" | sudo tee -a /etc/hosts
```

Then bridge port 80 on localhost to Traefik's Service (kind / minikube / Docker Desktop don't give the `LoadBalancer` Service an external IP):

```bash
sudo kubectl -n traefik port-forward svc/traefik 80:80 &
```

> **[doc-gap]** The pre-v0.100.3 install guide does not include any "install an ingress controller first" step. The Ingress + path-prefix section explains the configuration, but a newcomer following the Quick Start with EE values has no working browser path until they figure this out themselves. **Fix the new install guide** so the prerequisites step explicitly says "you must have an ingress controller running and pointing your `ingress.host` at it," and add a local-testing recipe (Traefik v3 + `/etc/hosts` + port-forward).

### 1.1 Create the namespace and image pull secret

```bash
kubectl create namespace agenta

kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=$GH_USER \
  --docker-password=$GH_PAT \
  --namespace agenta
```

> The docs write `--docker-server=<ee-server>` etc. as placeholders. For internal EE that resolves to `ghcr.io`. **[doc-gap]** — pre-v0.100.3 docs should state `ghcr.io` directly instead of the unexplained `<ee-server>`. The v0.100.3 install guide already does this.

### 1.2 Copy the EE example values file and edit it

Make a sibling of the example so the original stays untouched:

```bash
cp hosting/helm/agenta-oss/values-ee.example.yaml \
   hosting/helm/agenta-oss/values-ee.yaml
```

Open `hosting/helm/agenta-oss/values-ee.yaml` and replace the placeholder values. Minimum changes:

```yaml
global:
  agentaLicense: ee
  webUrl: "http://agenta.example.com"
  apiUrl: "http://agenta.example.com/api"
  servicesUrl: "http://agenta.example.com/services"
  imagePullSecrets:
    - name: ghcr-pull-secret

secrets:
  agentaAuthKey: "<openssl rand -hex 32>"
  agentaCryptKey: "<openssl rand -hex 32>"
  postgresPassword: "<openssl rand -hex 16>"

ingress:
  enabled: true
  className: "traefik"
  host: "agenta.example.com"

api:
  image:
    tag: "<OLD_EE_TAG>"
web:
  image:
    tag: "<OLD_EE_TAG>"
services:
  image:
    tag: "<OLD_EE_TAG>"
```

Traefik needs a `StripPrefix` middleware so `/api` and `/services` are stripped before forwarding to the backends (the install guide's "Path Prefix Stripping" section). Add this to your values too:

```yaml
ingress:
  enabled: true
  className: "traefik"
  host: "agenta.example.com"
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: agenta-strip-prefixes@kubernetescrd

extraObjects:
  - apiVersion: traefik.io/v1alpha1
    kind: Middleware
    metadata:
      name: strip-prefixes
      namespace: "{{ .Release.Namespace }}"
    spec:
      stripPrefix:
        prefixes:
          - /api
          - /services
```

> **[doc-gap]** The pre-v0.100.3 EE section says "replace the placeholder secrets and URLs" but never tells the EE reader to actually generate secrets the way the OSS section does. Save the three values now — you need them in Phase 3.

### 1.3 Install

```bash
helm install agenta hosting/helm/agenta-oss \
  --namespace agenta \
  -f hosting/helm/agenta-oss/values-ee.yaml
```

### 1.4 Verify ("Verify" step from the same docs)

```bash
kubectl -n agenta get pods -w
kubectl -n agenta get jobs
```

Once everything is `Running` and the Alembic Job shows `Complete`, open `http://agenta.example.com` in your browser. Sign up a test user and create one project (so you have data to verify after the migration).

---

## Phase 2 — Snapshot the existing values

**Source:** `docs/docs/self-host/upgrades/v0.100.3-migration.mdx`, step 1.

```bash
helm -n agenta get values agenta -o yaml > ../pre-v0.100.3-values.yaml
cat ../pre-v0.100.3-values.yaml
```

The migration guide also gives the `kubectl`-only fallback for unwrapping the release Secret if `helm` isn't available. Skip it for QA unless `helm get values` returns nothing.

---

## Phase 3 — Migrate to v0.100.3

### 3.1 Switch the checkout to the new chart layout

The migration guide says:

```bash
git fetch
git checkout release/v0.100.3
```

For QA, check out the unmerged branch instead:

```bash
git fetch
git checkout chore/update-deployment-artifacts   # [QA-only]
```

> **[doc-gap]** The migration guide assumes the user already has a checkout sitting on the same working directory. It does **not** explain that the chart path moved from `hosting/helm/agenta-oss/` (gone after this checkout) to `hosting/kubernetes/helm/`. The "Chart folder relocation" table at the top mentions it; step 2 should remind the reader.

### 3.2 Pick a values path (Path A or Path B)

The chart accepts both the pre-v0.100.3 values shape (via the compat layer in `_compat.tpl`) and the canonical v0.100.3 shape. Test both so we know both work.

**Path A — reuse the legacy file as-is.** Use `../pre-v0.100.3-values.yaml` from Phase 2 directly as the `-f` argument to `helm upgrade` in §3.4. Skip §3.3 entirely. Expected: `helm install` prints a one-line `NOTE: pre-v0.100.3 values keys detected …` callout, and all pods come up with the same env-var values as Path B. Confirms compat layer is wired.

**Path B — rewrite into the canonical shape.** Section 3.3 below. Confirms the canonical shape works in isolation and gives us a clean values file to keep.

For the full QA pass, do **Path B first** (it exercises every rename), then re-run §3.4–§3.6 with `-f ../pre-v0.100.3-values.yaml` (Path A) to confirm both shapes produce equivalent installs against the same cluster. Tear down between the two runs using `--nuke` from `hosting/kubernetes/run.sh` so PVCs don't carry state across.

### 3.2.1 Create the edition-specific values file (step 3 of the guide)

```bash
cp hosting/kubernetes/ee/values.ee.example.yaml \
   hosting/kubernetes/ee/.values.ee.yaml
```

### 3.3 Translate the old values into the new shape (step 4 of the guide — Path B only)

Open `../pre-v0.100.3-values.yaml` (from Phase 2) next to `hosting/kubernetes/ee/.values.ee.yaml`. Walk through and rewrite using the reshape table at the top of the migration guide. For the test deployment, the relevant moves are:

| from `pre-v0.100.3-values.yaml` | to `.values.ee.yaml` |
| --- | --- |
| `global.agentaLicense: ee` | `agenta.license: ee` |
| `global.webUrl` / `apiUrl` / `servicesUrl` | `agenta.webUrl` / `apiUrl` / `servicesUrl` |
| `global.imagePullSecrets` | `global.imagePullSecrets` (unchanged) |
| `secrets.agentaAuthKey` | `agenta.authKey` |
| `secrets.agentaCryptKey` | `agenta.cryptKey` |
| `secrets.postgresPassword` | `postgres.password` |
| `api.image.tag` / `web.image.tag` / `services.image.tag` | same paths — but bump the value from `$OLD_EE_TAG` to `$NEW_EE_TAG` |

The auth key, crypt key, and postgres password **must match what was deployed in Phase 1** — the encrypted data in the DB cannot be read with a different crypt key, and the bundled Postgres PVC still uses the old password.

The image tag is the one thing that **must change**: bump `api.image.tag`, `web.image.tag`, and `services.image.tag` to `$NEW_EE_TAG`. That's the point of the upgrade.

Also exercise the new `agenta.access.defaultPlanOverlay` knob that v0.100.3 introduces (called out as a `:::tip` in the migration guide). Add this block to `.values.ee.yaml` to validate it ships into the API pod env:

```yaml
agenta:
  access:
    defaultPlanOverlay:
      counters:
        traces_retrieved:
          limit: 1000
          strict: true
          period: daily
          scope: user
```

After the upgrade you can confirm it took effect with:

```bash
kubectl -n agenta exec deploy/agenta-agenta-oss-api -- \
  printenv AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY
```

The value should be the JSON form of the overlay block above.

### 3.4 Run the upgrade (step 5 of the guide)

```bash
helm upgrade agenta hosting/kubernetes/helm \
  --namespace agenta \
  -f hosting/kubernetes/ee/.values.ee.yaml
```

### 3.5 Watch the migration job

```bash
kubectl -n agenta get jobs
kubectl -n agenta get pods -w
```

---

## Phase 4 — Verify (step 6 of the guide)

```bash
# All pods Running. Note: agenta-postgresql-0 and agenta-agenta-oss-redis-durable-0
# will have AGE matching the upgrade time (not Phase 1), because their StatefulSets
# were force-rolled by helm. PVCs survive — verify with the PVC check below.
kubectl -n agenta get pods

# PVCs preserved from Phase 1 (this proves your data survived)
kubectl -n agenta get pvc
# Both should show AGE from Phase 1, BOUND, sizes 10Gi (postgres) and 5Gi (redis-durable).
```

Migration Job:

```bash
kubectl -n agenta get jobs
kubectl -n agenta logs job/agenta-agenta-oss-alembic -c alembic --tail=20
```

> **[doc-gap CONFIRMED]** The migration guide says `kubectl -n agenta logs job/agenta-alembic`, but the v0.100.3 chart emits `agenta-agenta-oss-alembic` (the `include "agenta.fullname"` helper produces `<release>-<chart>` = `agenta-agenta-oss`). Same naming as v0.100.1. **Fix the new migration guide** to use `agenta-agenta-oss-alembic`.
>
> **[QA note]** The Alembic Job may show 2-3 pods, some in `Error` and one in `Completed`. That's expected: when Helm re-rolls the Postgres StatefulSet, the first alembic attempts hit `CannotConnectNowError: the database system is shutting down`. The Job retries (backoffLimit=3) and the final pod succeeds. As long as `kubectl get jobs` shows `Complete 1/1`, you're fine. If `kubectl logs job/...` picks an Errored pod, run `kubectl logs <completed-pod-name> -c alembic` directly.

API health check (via the ingress):

```bash
curl -fsS http://agenta.example.com/api/health
```

> **[doc-gap CONFIRMED]** The migration guide tells the reader to port-forward `svc/agenta-api`, but the v0.100.3 chart creates `svc/agenta-agenta-oss-api` (same naming as v0.100.1). **Fix the new migration guide** — or do the verify step via the ingress URL like above, which is naming-agnostic.

Then open `http://agenta.example.com` and confirm:

- The test user from Phase 1 can still log in (same auth key, same DB).
- The project from Phase 1 is still listed.

---

## Phase 5 — Pass / Fail criteria

**PASS** if all of these hold:

- `helm -n agenta list` shows revision incremented, status `deployed`
- All pods `Running`, no `CrashLoopBackOff` or `ImagePullBackOff`
- Alembic post-upgrade Job succeeded
- The user created in Phase 1.4 can still log in after the upgrade
- The project from Phase 1.4 is still visible

**FAIL** → capture and attach:

- `helm -n agenta history agenta`
- `kubectl -n agenta get events --sort-by=.lastTimestamp | tail -30`
- `kubectl -n agenta describe pod <failing-pod>`
- `kubectl -n agenta logs <failing-pod> --previous`
- `../pre-v0.100.3-values.yaml` and `hosting/kubernetes/ee/.values.ee.yaml`

---

## Phase 6 — Cleanup

```bash
# Stop the Traefik port-forward from Phase 1.0
kill %1 2>/dev/null || true

helm -n agenta uninstall agenta
kubectl delete namespace agenta   # cascades to PVCs and everything else

helm -n traefik uninstall traefik
kubectl delete namespace traefik

sudo sed -i.bak '/agenta\.example\.com/d' /etc/hosts

cd ..
rm -rf agenta
rm -f pre-v0.100.3-values.yaml
```

---

## Doc-gaps found during this QA plan

1. **Pre-v0.100.3 install guide, EE section** — (a) uses `<ee-server>` instead of `ghcr.io`; (b) does not tell EE readers to generate `agentaAuthKey`/`agentaCryptKey`/`postgresPassword` (the OSS section does); (c) `cp hosting/helm/agenta-oss/values-ee.example.yaml` snippet writes to bare `values-ee.yaml`, which is ambiguous about cwd, and the matching `helm install -f values-ee.yaml` fails if you guessed wrong. **Status: NOT FIXED** — the pre-v0.100.3 doc is frozen on `main` and won't be revised; left here so future readers of this QA plan know to watch for it.
2. **v0.100.3 install guide didn't tell users to install an ingress controller** before deploying. Without one, the chart installs but the browser can't reach `/api` and `/services`. **Status: FIXED** in `docs/docs/self-host/guides/03-deploy-to-kubernetes.mdx` — added an ingress prerequisite and a "Local testing with Traefik" recipe (Traefik v3 + `/etc/hosts` + port-forward).
3. **v0.100.3 install guide referenced pre-v0.100.3 values paths** (`secrets.agentaAuthKey`, `global.webUrl`, `global.agentaLicense`) — wrong for the new chart shape. **Status: FIXED** — rewritten to use `agenta.authKey` / `agenta.webUrl` / `agenta.license` and `postgres.password`. Troubleshooting section also updated.
4. **v0.100.3 install guide had no "generate secrets" snippet for EE** even though OSS did. **Status: FIXED** — `openssl rand -hex 32/16` snippet added next to the values block.
5. **v0.100.3 migration guide step 6 used wrong resource names** — `kubectl logs job/agenta-alembic` and `port-forward svc/agenta-api` don't exist. The chart actually emits `agenta-agenta-oss-alembic` and `agenta-agenta-oss-api` (via the `agenta.fullname` helper = `<release>-<chart>`). **Status: FIXED** — `docs/docs/self-host/upgrades/v0.100.3-migration.mdx` now uses the real names and switches the health check to `curl http://<ingress-host>/api/health` so the snippet is naming-agnostic.
6. **v0.100.3 migration guide didn't warn about Alembic Job retries** during the upgrade — Helm re-rolls Postgres, the first one or two alembic pods fail with `CannotConnectNowError`, and the Job retries to success. Confusing if you don't expect it. **Status: FIXED** — added a `:::note Alembic job retries` callout to the verify step explaining the expected behavior and how to find the successful pod's logs.
7. **Chart regression: v0.100.3 `helm/values.yaml` didn't pin `postgresql.primary.persistence.size`, and dropped `redisDurable.persistence.enabled: true`**. Both caused `helm upgrade` to fail on v0.100.1→v0.100.3 with `StatefulSet spec is invalid: spec: Forbidden` (Bitnami subchart picked a different PVC size; redis StatefulSet lost its volumeClaimTemplates). **Status: FIXED** — `hosting/kubernetes/helm/values.yaml` pins postgres PVC to `10Gi`; `hosting/kubernetes/helm/templates/redis-durable-statefulset.yaml` defaults persistence to `true` via `default true $persistence.enabled`. Example files (`values.{oss,ee}.example.yaml`) also show both knobs and the Traefik StripPrefix middleware (commented out) so future readers find them.
