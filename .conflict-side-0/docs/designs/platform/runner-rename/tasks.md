# Tasks — Runner rename

> Ordered, implement-ready. No open questions — see [specs.md](./specs.md). `[ ]` = not started.

## 0. Decided / blockers

- [x] Breaking rename, no compat shim — nothing is deployed.
- [x] `SANDBOX_AGENT_PROVIDER` kept as-is (borderline; engine-name contract; revisit with engine rename).
- [x] `sandbox_agent` engine subdir kept as-is; only its parent dir moves.
- [x] Env classification rule: runner-infra → `AGENTA_RUNNER_*`; agent-behaviour stays `AGENTA_AGENT_*`; MCP flags stay `AGENTA_AGENT_*` with `MCP`→`MCPS`.
- [x] k8s orphaned-Deployment caveat: apply as replace on live clusters.
- [x] Railway service-name is external state: rename the Railway service in the same change.
- [x] Test job grows into a `runner-{unit,integration,acceptance}` family.

---

## 1. Package dir move — `services/agent` → `services/runner`

_Do this first. Fix all absolute/build-context refs before the compose rename so a single
`run.sh --build` validates both the new context path and the new service name._

- [ ] `git mv services/agent services/runner`; confirm `services/runner/src/engines/sandbox_agent/`
      is intact.
- [ ] Run `pnpm install && pnpm run typecheck && pnpm run test:unit` from `services/runner` to
      confirm nothing internal broke.
- [ ] **Compose build contexts + bind mounts** (6 files — grep confirms):
      - `hosting/docker-compose/oss/docker-compose.dev.yml` — `context`, 2× bind mounts (`src`, `skills`)
      - `hosting/docker-compose/ee/docker-compose.dev.yml` — `context`, 2× bind mounts
      - `hosting/docker-compose/oss/docker-compose.gh.local.yml` — `context`
      - `hosting/docker-compose/ee/docker-compose.gh.local.yml` — `context`
      - `hosting/docker-compose/oss/docker-compose.gh.ssl.yml` — `context`
      - (gh variants without a `context:` line need no change here)
      All: `../../../services/agent` → `../../../services/runner`.
- [ ] **CI — `.github/workflows/42-railway-build.yml`** (L132–133):
      `context: services/agent` → `services/runner`;
      `dockerfile: services/agent/docker/Dockerfile` → `services/runner/docker/Dockerfile`.
- [ ] **CI — `.github/workflows/12-check-unit-tests.yml`** (L321, L357, L363–387):
      `working-directory: services/agent` → `services/runner` (all occurrences);
      cache key `hashFiles('services/agent/pnpm-lock.yaml')` → `services/runner/pnpm-lock.yaml`;
      junit `files: services/agent/test-results/junit.xml` → `services/runner/...`.
- [ ] **Railway build script** `hosting/railway/oss/scripts/build-and-push-images.sh` (L33):
      `-f .../services/agent/docker/Dockerfile` + build context `services/agent` →
      `services/runner/docker/Dockerfile` + `services/runner`.
- [ ] Re-grep `services/agent` across `hosting/`, `.github/`, root tooling
      (`turbo.json`, root `package.json`, `pnpm-workspace.yaml`) — catch any residual refs.

---

## 2. Compose — service key, hostname, dev image name

- [ ] **7 compose files** — in each: service key `sandbox-agent:` → `runner:`;
      dev anchor `.sandbox-agent:` → `.runner:` (dev files only);
      `depends_on:` entry `sandbox-agent` → `runner`.
  - `hosting/docker-compose/oss/docker-compose.dev.yml`
  - `hosting/docker-compose/ee/docker-compose.dev.yml`
  - `hosting/docker-compose/oss/docker-compose.gh.yml`
  - `hosting/docker-compose/ee/docker-compose.gh.yml`
  - `hosting/docker-compose/oss/docker-compose.gh.local.yml`
  - `hosting/docker-compose/ee/docker-compose.gh.local.yml`
  - `hosting/docker-compose/oss/docker-compose.gh.ssl.yml`
- [ ] **Dev image names** (dev files only):
      `agenta-ee-dev-sandbox-agent:latest` → `agenta-ee-dev-runner:latest`;
      `agenta-oss-dev-sandbox-agent:latest` → `agenta-oss-dev-runner:latest`.
- [ ] **Env examples** (cosmetic, 4 files — update hostname doc and section header):
  - `hosting/docker-compose/oss/env.oss.dev.example` — `http://sandbox-agent:8765` ref + section header
  - `hosting/docker-compose/oss/env.oss.gh.example`
  - `hosting/docker-compose/ee/env.ee.dev.example`
  - `hosting/docker-compose/ee/env.ee.gh.example`
- [ ] `docker compose config` parses for all 7 files without errors.
- [ ] `run.sh --oss --dev --build` confirms the `runner` service builds from `services/runner`,
      `agenta-oss-dev-runner:latest` image produced, and `services` container reaches `runner:8765`.

---

## 3. Helm / k8s

- [ ] Rename template files:
      `hosting/kubernetes/helm/templates/sandbox-agent-service.yaml` → `runner-service.yaml`;
      `hosting/kubernetes/helm/templates/sandbox-agent-deployment.yaml` → `runner-deployment.yaml`.
- [ ] In `runner-service.yaml` and `runner-deployment.yaml`:
      `app.kubernetes.io/component: sandbox-agent` → `runner` (selector + labels — both files,
      every occurrence, including the deployment's pod template and the container `- name:` line).
- [ ] `hosting/kubernetes/helm/templates/_helpers.tpl` (~L326):
      `agenta.agentRunner.serviceName` body `{{ include "agenta.fullname" . }}-sandbox-agent`
      → `-runner`. This changes the in-cluster DNS name — consistent with orphaned-Deployment caveat.
- [ ] Comment-only cosmetic refs (update for consistency):
      - `hosting/kubernetes/helm/values.yaml` (~L108, L130–131)
      - `hosting/kubernetes/helm/values.schema.json` (~L389)
      - `hosting/kubernetes/oss/values.oss.example.yaml` (~L178)
      - `hosting/kubernetes/ee/values.ee.example.yaml` (~L191)
- [ ] `helm template hosting/kubernetes/helm` renders without error.
- [ ] **⚠ Cluster caveat in PR:** selector + serviceName change orphans the old
      Deployment/Service; apply as a replace (delete old, apply new) on any live cluster.

---

## 4. Railway (`hosting/railway/oss/`)

- [ ] Rename wrapper dir `sandbox-agent/` → `runner/` (contains only `Dockerfile`).
- [ ] `scripts/deploy-services.sh` (L33): `--path-as-root .../sandbox-agent --service sandbox-agent`
      → `.../runner --service runner`.
- [ ] `scripts/deploy-from-images.sh`:
      `$TMP_DIR/sandbox-agent` (L149, L243) → `$TMP_DIR/runner`;
      `--service sandbox-agent` (L243) → `--service runner`.
      Optional: rename `render_sandbox_agent_wrapper` fn.
- [ ] `scripts/bootstrap.sh` (L150):
      `add_service_image sandbox-agent "$SANDBOX_AGENT_IMAGE"` → `runner "$RUNNER_IMAGE"`;
      also rename the shell-local var `SANDBOX_AGENT_IMAGE` → `RUNNER_IMAGE` (L19, L49, L56 in
      `build-and-push-images.sh` and `bootstrap.sh`) for consistency.
- [ ] `scripts/configure.sh` — **4 refs** (previously missed):
      - L209 `'${{sandbox-agent.RAILWAY_PRIVATE_DOMAIN}}'` → `'${{runner.RAILWAY_PRIVATE_DOMAIN}}'`
      - L263 `set_vars sandbox-agent \` → `runner`
      - L267 `set_optional_vars sandbox-agent \` → `runner`
      - L277 `unset_vars sandbox-agent ...` → `runner ...`
      - L376 `set_healthcheck sandbox-agent "/health"` → `runner "/health"`
- [ ] `README.md` (4 refs ~L26/L39/L123/L214): dir reference + prose.
- [ ] **⚠ Railway caveat in PR:** service name is external persisted state. Rename the Railway
      project service from `sandbox-agent` to `runner` before or in the same deployment; the
      `${{runner.RAILWAY_PRIVATE_DOMAIN}}` ref and the `--service runner` flag must match the
      live service name exactly.

---

## 5. Env vars — source code + hosting config

_Rename all occurrences of the vars in the rename table from specs.md. Covers runner source,
compose files (same pass as §2), Helm helpers, Railway scripts, Python services, tests._

### Runner-infra vars → `AGENTA_RUNNER_*`

- [ ] `services/agent/src/server.ts` (now `services/runner/src/server.ts`):
      `AGENTA_RUNNER_PORT` → `AGENTA_RUNNER_PORT`;
      `AGENTA_RUNNER_HOST` → `AGENTA_RUNNER_HOST`;
      `RUNNER_TOKEN_ENV = "AGENTA_RUNNER_TOKEN"` → `"AGENTA_RUNNER_TOKEN"`.
- [ ] `services/agent/src/sessions/alive.ts`:
      `AGENTA_RUNNER_REPLICA_ID` → `AGENTA_RUNNER_REPLICA_ID`.
- [ ] `services/agent/tests/unit/server.test.ts`:
      `TOKEN_ENV = "AGENTA_RUNNER_TOKEN"` → `"AGENTA_RUNNER_TOKEN"`.
- [ ] `services/agent/tests/unit/mcp-servers.test.ts`:
      (no runner-infra vars here — verify and skip if clean).
- [ ] All compose files (as part of §2 pass) — `AGENTA_RUNNER_URL`, `_PORT`, `_HOST`,
      `_IMAGE_NAME`, `_IMAGE_TAG`, `_TOKEN`, `_REPLICA_ID`.
- [ ] `hosting/docker-compose/oss/docker-compose.dev.yml` + ee counterpart:
      `AGENTA_API_URL: ${AGENTA_RUNNER_API_URL:-http://api:8000}` →
      `AGENTA_API_URL: ${AGENTA_RUNNER_API_URL:-http://api:8000}`.
- [ ] All other compose files with `AGENTA_RUNNER_API_URL` (6 files total — grep confirms).
- [ ] `hosting/railway/oss/sandbox-agent/Dockerfile` (now `runner/Dockerfile`):
      `ENV AGENTA_RUNNER_PORT=8765` → `ENV AGENTA_RUNNER_PORT=8765`.
- [ ] `hosting/railway/oss/scripts/build-and-push-images.sh` and `bootstrap.sh`:
      `AGENTA_RUNNER_IMAGE` → `AGENTA_RUNNER_IMAGE`; `preview-resolve-env.sh` same.
- [ ] `hosting/railway/oss/scripts/configure.sh` (L255, L264):
      `AGENTA_RUNNER_URL` → `AGENTA_RUNNER_URL`;
      `AGENTA_RUNNER_PORT` → `AGENTA_RUNNER_PORT`.
- [ ] `hosting/kubernetes/helm/templates/_helpers.tpl` — all `AGENTA_RUNNER_*` env
      name strings in the `agentRunner.env` block; `AGENTA_RUNNER_API_URL` → `AGENTA_RUNNER_API_URL`.
- [ ] `hosting/kubernetes/helm/values.schema.json` (~L389): update description string.
- [ ] `services/oss/src/agent/config.py` (L48): `AGENTA_RUNNER_URL` → `AGENTA_RUNNER_URL`.
- [ ] `services/oss/src/agent/app.py`: any `AGENTA_RUNNER_URL` prose → `AGENTA_RUNNER_URL`.
- [ ] `services/oss/tests/pytest/unit/agent/test_select_backend.py`: update monkeypatch env names.
- [ ] `services/agent/README.md` (now `services/runner/README.md`): env var refs.
- [ ] Env example files (4): `AGENTA_RUNNER_URL`, `_IMAGE_NAME`, `_IMAGE_TAG`,
      `AGENTA_AGENT_MCPS_ENABLED` (see MCP section below).

### MCP flag alignment → `AGENTA_AGENT_MCPS_*`

- [ ] `services/agent/src/engines/sandbox_agent/mcp.ts`:
      `AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED`;
      `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` → `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`.
- [ ] `services/agent/tests/unit/mcp-servers.test.ts`:
      `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` → `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`.
- [ ] `services/oss/src/agent/tools/resolver.py`: `AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED`.
- [ ] `services/oss/tests/pytest/unit/agent/tools/test_resolution.py`:
      monkeypatch env name `AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED`.
- [ ] All compose files: `AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED` (7 files).
- [ ] `hosting/kubernetes/helm/templates/_helpers.tpl` (~L345–346):
      `AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED`;
      key `enableMcp` may stay (Helm values key — cosmetic, operator-visible but low-churn).
- [ ] `hosting/kubernetes/helm/values.schema.json` (~L396): update description string.
- [ ] `hosting/kubernetes/{oss,ee}/values.*.example.yaml` (`enableMcp` comment lines): update.
- [ ] Env example files (4): `AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED`.
- [ ] `hosting/railway/oss/scripts/configure.sh` (L256): update the var name.

---

## 6. CI — test job rename + path retarget

- [ ] `.github/workflows/12-check-unit-tests.yml`:
      - Job id `run-services-node-unit-tests` → `run-runner-tests` (job key).
      - Comment (~L321): update prose from "services/agent" to "services/runner".
      - All `working-directory: services/agent` → `services/runner` (already covered in §1).
      - Cache key `services-agent-pnpm` → `runner-pnpm`.
      - junit `files:` path (already covered in §1).
      - Check name "Agent Runner Unit Test Results" already reads correctly — keep.
- [ ] Add sibling job stubs `runner-integration` and `runner-acceptance` (empty / `echo "TODO"`)
      with correct `working-directory: services/runner` and a comment marking them as
      implementation targets for the sessions test worktree.

---

## 7. Final grep sweep + validation

- [ ] `grep -rn "sandbox-agent" hosting/ .github/` — must return only the keep-list:
      none after §2–§4; any hit is a miss.
- [ ] `grep -rn "services/agent" hosting/ .github/` — must return nothing.
- [ ] `grep -rn "AGENTA_RUNNER_" . --include="*.ts" --include="*.py" --include="*.yml"
      --include="*.yaml" --include="*.sh"` — must return nothing.
- [ ] `grep -rn "AGENTA_AGENT_MCPS_ENABLED\|AGENTA_AGENT_MCPS_HOST_ALLOWLIST" .` —
      must return nothing.
- [ ] `docker compose config` for all 7 compose files (no parse errors).
- [ ] `helm template hosting/kubernetes/helm` renders without error.
- [ ] Dev stack smoke: `run.sh --oss --dev --build`; session heartbeat + record-persist
      round-trip confirms runner is reachable at `runner:8765`.
- [ ] Re-confirm keep-list untouched: `services/runner/src/engines/sandbox_agent/` exists;
      `SANDBOX_AGENT_PROVIDER` present in configure.sh/compose; `AGENTA_API_URL` inner var
      unchanged in server.ts.

---

## Out of scope (this worktree)

- `sandbox_agent` engine subdir rename — separate chore.
- npm package `sandbox-agent` — third-party.
- `AGENTA_AGENT_*` behaviour vars (tools, skills, usage, SANDBOX_PI_*) — unchanged.
- `AGENTA_MOUNTS_TUNNEL_API` and `AGENTA_MOUNTS_STORAGE_*` / `AGENTA_STORE_*` — W6 (store-generalization).
- Docs prose under `docs/design/agent-workflows/` — W7.
- E2B/Modal providers, codex/opencode harnesses — not yet on the branch.
- `runner-integration` and `runner-acceptance` test implementations — sessions test worktree.
