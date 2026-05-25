# QA Plan — Pre-v0.100.2 → v0.100.2 Helm Migration

Goal: install Agenta on Kubernetes by following the **pre-v0.100.2 install docs verbatim**, then follow the **v0.100.2 migration docs verbatim**, and confirm the deployment still works.

You will need an EE image tag that exists on `ghcr.io/agenta-ai/internal-ee-*`. Substitute `<EE_TAG>` everywhere it appears below. You will also need a GitHub PAT with `read:packages` on the EE org.

> Everything in this plan comes from the published docs. Lines marked **[QA-only]** are testing-harness additions (e.g. picking which tag to use); lines marked **[doc-gap]** are places where I had to fill in a step that the public docs do not actually tell the user, and the doc should be fixed.

---

## Phase 0 — Pick a clean starting state

```bash
# [QA-only] Use a scratch worktree of main so the test isn't polluted by this branch
cd /Users/junaway/Agenta/github/application
git fetch origin main
git worktree add /tmp/agenta-main origin/main
cd /tmp/agenta-main
```

Pick a tag to test with (any existing EE tag works):

```bash
export EE_TAG=<EE_TAG>           # [QA-only]
export GH_USER=<your-gh-user>    # [QA-only]
export GH_PAT=<your-read-packages-pat>  # [QA-only]
```

---

## Phase 1 — Install from pre-v0.100.2 docs (Enterprise Edition)

**Source:** `docs/docs/self-host/guides/03-deploy-to-kubernetes.mdx` on `main`, section _Deploy Enterprise Edition_.

The docs say, verbatim:

### 1.1 Create the namespace and image pull secret

```bash
kubectl create namespace agenta

kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=$GH_USER \
  --docker-password=$GH_PAT \
  --namespace agenta
```

> The docs write `--docker-server=<ee-server>` etc. as placeholders. For internal EE that resolves to `ghcr.io`. **[doc-gap]** — pre-v0.100.2 docs should state `ghcr.io` directly instead of the unexplained `<ee-server>`. The v0.100.2 install guide already does this.

### 1.2 Copy the EE example values file and edit it

```bash
cp hosting/helm/agenta-oss/values-ee.example.yaml values-ee.yaml
```

Open `values-ee.yaml` and replace the placeholder values. Minimum changes:

```yaml
global:
  agentaLicense: ee
  webUrl: "http://localhost"
  apiUrl: "http://localhost/api"
  servicesUrl: "http://localhost/services"
  imagePullSecrets:
    - name: ghcr-pull-secret

secrets:
  agentaAuthKey: "<openssl rand -hex 32>"
  agentaCryptKey: "<openssl rand -hex 32>"
  postgresPassword: "<openssl rand -hex 16>"

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

> **[doc-gap]** The pre-v0.100.2 EE section says "replace the placeholder secrets and URLs" but never tells the EE reader to actually generate secrets the way the OSS section does. Save the three values now — you need them in Phase 3.

### 1.3 Install

```bash
helm install agenta hosting/helm/agenta-oss \
  --namespace agenta \
  -f values-ee.yaml
```

### 1.4 Verify ("Verify" step from the same docs)

```bash
kubectl -n agenta get pods -w
kubectl -n agenta get jobs
```

Once everything is `Running`:

```bash
kubectl port-forward svc/agenta-agenta-oss-web 3000:3000 -n agenta
```

Open `http://localhost:3000`, sign up a test user, create one project (so you have data to verify after the migration). Stop the port-forward.

---

## Phase 2 — Snapshot the existing values

**Source:** `docs/docs/self-host/upgrades/v0.100.2-migration.mdx`, step 1.

```bash
helm -n agenta get values agenta -o yaml > /tmp/pre-v0.100.2-values.yaml
cat /tmp/pre-v0.100.2-values.yaml
```

The migration guide also gives the `kubectl`-only fallback for unwrapping the release Secret if `helm` isn't available. Skip it for QA unless `helm get values` returns nothing.

---

## Phase 3 — Migrate to v0.100.2

### 3.1 Switch to the new chart layout

The migration guide says:

```bash
git fetch
git checkout release/v0.100.2
```

For QA we test the branch instead of a tag:

```bash
# [QA-only] testing against the unmerged branch
cd /Users/junaway/Agenta/github/application
git checkout chore/update-deployment-artifacts
```

> **[doc-gap]** The migration guide assumes the user already has a checkout sitting on the same working directory. It does **not** explain that the chart path moved from `hosting/helm/agenta-oss/` (gone on this branch) to `hosting/kubernetes/helm/`. The "Chart folder relocation" table at the top mentions it; step 2 should remind the reader.

### 3.2 Create the edition-specific values file (step 3 of the guide)

```bash
cp hosting/kubernetes/ee/values.ee.example.yaml \
   hosting/kubernetes/ee/.values.ee.yaml
```

### 3.3 Translate the old values into the new shape (step 4 of the guide)

Open `/tmp/pre-v0.100.2-values.yaml` (from Phase 2) next to `hosting/kubernetes/ee/.values.ee.yaml`. Walk through and rewrite using the reshape table at the top of the migration guide. For the test deployment, the relevant moves are:

| from `pre-v0.100.2-values.yaml` | to `.values.ee.yaml` |
| --- | --- |
| `global.agentaLicense: ee` | `agenta.license: ee` |
| `global.webUrl` / `apiUrl` / `servicesUrl` | `agenta.webUrl` / `apiUrl` / `servicesUrl` |
| `global.imagePullSecrets` | `global.imagePullSecrets` (unchanged) |
| `secrets.agentaAuthKey` | `agenta.authKey` |
| `secrets.agentaCryptKey` | `agenta.cryptKey` |
| `secrets.postgresPassword` | `postgres.password` |
| `api.image.tag` / `web.image.tag` / `services.image.tag` | same paths (unchanged) |

The auth key, crypt key, and postgres password **must match what was deployed in Phase 1** — the encrypted data in the DB cannot be read with a different crypt key, and the bundled Postgres PVC still uses the old password.

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
# All pods Running
kubectl -n agenta get pods

# Migration job completed
kubectl -n agenta logs job/agenta-alembic | tail
```

> **[doc-gap]** The migration guide says `kubectl -n agenta logs job/agenta-alembic`, but the install docs (and the chart's resource naming on `main`) actually produce `agenta-agenta-oss-alembic`. Confirm which name the v0.100.2 chart emits and either fix the chart or fix the guide. Run `kubectl -n agenta get jobs` to see the real name in your environment.

API health check (verbatim from the guide):

```bash
kubectl -n agenta port-forward svc/agenta-api 8000:8000 &
curl -s http://localhost:8000/health
```

> **[doc-gap]** The pre-v0.100.2 docs port-forward `svc/agenta-agenta-oss-web`. The migration guide port-forwards `svc/agenta-api`. Confirm the post-upgrade Service name and update whichever document is wrong. Run `kubectl -n agenta get svc` to see the actual names.

Then open the web UI on the same port-forward you used in Phase 1.4 (substitute the new Service name if it changed) and confirm:

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
- `/tmp/pre-v0.100.2-values.yaml` and `hosting/kubernetes/ee/.values.ee.yaml`

---

## Phase 6 — Cleanup

```bash
helm -n agenta uninstall agenta
kubectl -n agenta delete pvc -l app.kubernetes.io/instance=agenta   # see Uninstall section of install docs
kubectl delete namespace agenta
git worktree remove /tmp/agenta-main
rm -f /tmp/pre-v0.100.2-values.yaml
```

---

## Doc-gaps found during this QA plan (to fix before release)

1. **Pre-v0.100.2 install guide, EE section** — uses `<ee-server>` instead of `ghcr.io`, and does not tell EE readers to generate `agentaAuthKey`/`agentaCryptKey`/`postgresPassword` (the OSS section does). **Pre-merge, not blocking** — the pre-v0.100.2 doc is frozen on `main`. Document this for users who hit it; no fix expected on the old docs.
2. **v0.100.2 migration guide, step 2** — does not call out that the chart path moved from `hosting/helm/agenta-oss/` to `hosting/kubernetes/helm/` at the same point the user `git checkout`s. The relocation table is at the top of the page, but the step itself reads as if nothing changed on disk. **Fix the new migration guide.**
3. **v0.100.2 verify step** — the Job and Service names referenced (`agenta-alembic`, `svc/agenta-api`) may not match what the chart actually emits (pre-v0.100.2 chart produced `agenta-agenta-oss-alembic` and `agenta-agenta-oss-web`). Confirm against `helm template hosting/kubernetes/helm` and either rename the resources to the shorter form or fix the guide to use the actual names. **Fix the new migration guide and/or the chart resource naming.**
