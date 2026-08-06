# Tasks — self-host docs: runner + mounts

> Ordered, design-first. `[ ]` = not started.
> Implementation agent reads specs.md before starting. MDX prose follows
> write-docs rules (`vibes/.claude/skills/write-docs/SKILL.md`): Docker/Stripe
> reference tone, active voice, no em dashes, no marketing adjectives, Diátaxis
> type per page.

## 0. Decided / blockers

- [x] Final env-var names: runner-infra `AGENTA_RUNNER_*` (W5), store `AGENTA_STORE_*`
      (W6), MCP flag `AGENTA_AGENT_MCPS_ENABLED` (W5).
- [x] `SANDBOX_AGENT_PROVIDER` name pending final W5 decision; write as-is with a note
      it reads on the runner service.
- [x] Helm store block: `store.*` / `store.seaweedfs.enabled` (post-W6); mirrors
      `postgresql.enabled` pattern.
- [x] Per-tier store: compose-local → SeaweedFS container; Railway → SeaweedFS service
      + volume; k8s → `seaweedfs.enabled` toggle; live/private → external AWS S3.
- [x] ngrok relevant only for compose-local + Daytona; omit from Railway/k8s/live pages.
- [x] MDX pages are edits to existing files (07/08/09 already written; 01-architecture,
      02-networking, 02-configuration need updates). One new file: upgrade note.
- [x] Do not touch `docs/docs/reference/api/` auto-generated files.

## 1. Update `self-host/infrastructure/01-architecture.mdx`

Target: `docs/docs/self-host/infrastructure/01-architecture.mdx`

Page type: Explanation. Lead with the model. Extend the existing diagram and
component sections; do not restructure.

- [ ] Add the **runner sidecar** to the ASCII architecture diagram: new box between
      "Services API" and the infrastructure layer, labelled
      `runner :8765` with a directional arrow from "Services API".
- [ ] Add the **SeaweedFS** store box inside (or adjacent to) the Infrastructure Layer
      block, labelled `seaweedfs :8333 (compose/k8s-bundled) or external S3`.
- [ ] Add a `### Agent Runner` subsection under "Backend Components" (after the
      existing "Worker Services" subsection). One paragraph: what it is (Node.js
      TypeScript sidecar; `:8765`; `/run` + `/health`), what it does (starts harness
      processes in local or remote sandboxes, mounts durable storage, relays
      server-side tools), sandbox matrix (`local` for compose/k8s; `daytona` for
      remote). No marketing language. Link to `self-host/guides/deploy-the-agent-runner`.
- [ ] Add `worker-records` to the Worker Services bullet list (one line: "Persists
      agent session records from the `streams:records` Redis stream").
- [ ] Add a `### Durable Store (SeaweedFS / S3)` subsection under "Infrastructure
      Services". One short paragraph: what it is (S3-compatible object store backing
      durable agent workspaces), bundled vs external (`seaweedfs.enabled` toggle
      mirrors Postgres). No STS internals here — that belongs in the configuration
      reference. Link to the `## Mounts` row of `self-host/02-configuration`.
- [ ] Update "Services API depends on" dependency tree to include
      `└── runner sidecar (agent workflow execution via AGENTA_RUNNER_URL)`.
- [ ] Update "Worker Pool" dependency row with `worker-records`.

## 2. Update `self-host/infrastructure/02-networking.mdx`

Target: `docs/docs/self-host/infrastructure/02-networking.mdx`

Page type: Explanation + Reference (tables). Add to existing topology; do not
restructure. No em dashes; keep the dry tone the page already uses.

- [ ] Add `runner :8765` into the network topology ASCII diagram as an internal
      service under the bridge network, reached from "Services API". No external
      exposure (Traefik does not route to the runner).
- [ ] Add `seaweedfs :8333` to the diagram's infrastructure layer row (beside Redis).
      Annotate: "bundled (compose/k8s); optional — replaced by external S3/R2/MinIO".
- [ ] In "Internal Service Communication", add:
      - `Services API` section: add arrow to `runner:8765 (agent run dispatch)`.
      - New `Runner` section: `→ seaweedfs:8333 or external S3 (durable storage)`
        and `→ api:8000 (session record writes)`.
- [ ] Add a "Runner" row to the "Network Environment Variables" table (or a sub-table):
      `AGENTA_RUNNER_URL` — points the Services API at the runner; default
      `http://runner:8765` in compose, generated from `agentRunner.*` in Helm.
- [ ] Add one note after the table: compose-local running Daytona sandboxes requires the
      `remote` compose profile (ngrok tunnel) because the remote sandbox reaches the
      store over the public internet. Railway and Kubernetes do not need ngrok (store
      endpoint is publicly reachable). Keep this to two sentences.

## 3. Update `self-host/02-configuration.mdx` — "Agent runner" section

Target: `docs/docs/self-host/02-configuration.mdx`

Page type: Reference. Tables only. Dry. No narrative in cells.

- [ ] Rename the section header from "Agent runner" to "Agent runner" (keep) but
      update the introductory sentence to use the final service name `runner` (not
      `sandbox-agent`).
- [ ] Update all env-var names in the table to final post-W5 names:
      - `AGENTA_AGENT_RUNNER_URL` → `AGENTA_RUNNER_URL`
      - `AGENTA_AGENT_MCP_SERVERS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED`
      - `SANDBOX_AGENT_PROVIDER` stays (note: read by the runner service)
      - `SANDBOX_AGENT_LOG_LEVEL` stays
      - All `DAYTONA_*` stay
      - `AGENTA_AGENT_SANDBOX_PI_INSTALLED` stays
- [ ] Update the Helm `values.yaml` path column: `agentRunner.externalUrl` →
      `agentRunner.externalUrl` (same if unchanged in W5), and confirm
      `agentRunner.enableMcp` matches W5's final Helm key for `AGENTA_AGENT_MCPS_ENABLED`.
- [ ] Drop `AGENTA_AGENT_RUNNER_TIMEOUT_SECONDS` if it was renamed or add the W5 final
      name. (Check against W5 output; placeholder: keep with a note "renamed" if unsure.)

## 4. Update `self-host/02-configuration.mdx` — "Mounts" section

Target: `docs/docs/self-host/02-configuration.mdx` (same file, different section)

- [ ] Update section header from "Mounts (durable object store)" to "Store (durable
      object store)" to match the W6 namespace change.
- [ ] Update all env-var names to final post-W6 names:
      - `AGENTA_MOUNTS_STORAGE_ENDPOINT_URL` → `AGENTA_STORE_ENDPOINT_URL`
      - `AGENTA_MOUNTS_STORAGE_ACCESS_KEY` → `AGENTA_STORE_ACCESS_KEY`
      - `AGENTA_MOUNTS_STORAGE_SECRET_KEY` → `AGENTA_STORE_SECRET_KEY`
      - `AGENTA_MOUNTS_STORAGE_REGION` → `AGENTA_STORE_REGION`
      - `AGENTA_MOUNTS_STORAGE_BUCKET` → `AGENTA_STORE_BUCKET`
      - `AGENTA_MOUNTS_STORAGE_SIGNING_KEY` → `AGENTA_STORE_SIGNING_KEY`
- [ ] Update the `values.yaml` path column to post-W6 Helm keys (`store.*`):
      - `store.endpointUrl` (auto-populated when `store.seaweedfs.enabled=true`)
      - `store.accessKey`, `store.secretKey`, `store.region`, `store.bucket`,
        `store.signingKey`
- [ ] Add a row or note for `store.seaweedfs.enabled` (the bundle-or-external toggle):
      `true` bundles SeaweedFS (default on compose/k8s); `false` points at an external
      S3-compatible store via `store.endpointUrl`. Mirrors `postgresql.enabled`.
- [ ] Update the existing "SeaweedFS STS signing key" admonition: replace
      `AGENTA_MOUNTS_STORAGE_SIGNING_KEY` → `AGENTA_STORE_SIGNING_KEY`.
- [ ] Update the "Remote sandboxes" warning admonition: replace "mounts endpoint"
      language to match new naming; the substance (remote sandbox needs public endpoint
      or ngrok) stays.
- [ ] Update the prose paragraph that describes credential model: replace "mounts
      endpoint" with "store endpoint"; keep STS / `GetFederationToken` description.

## 5. Add `self-host/upgrades/runner-and-store.mdx`

Target: new file at `docs/docs/self-host/upgrades/runner-and-store.mdx`

Page type: How-to. Title = reader's goal. Only actions. No rationale. Link out for
background.

- [ ] Frontmatter: `title: Enable the agent runner and durable store`,
      `sidebar_label: Enable runner and store`. No `sidebar_position` — let the
      `upgrades/` directory ordering handle it or add to the relevant `_category_.json`.
- [ ] One-sentence context: what this page covers (enabling the new runner sidecar and
      durable workspace store on an existing self-hosted Agenta deployment).
- [ ] Prerequisites list: Agenta version that includes `big-agents` / runner; existing
      compose or Helm deployment.
- [ ] Steps (compose path):
      1. Pull the new image set (docker compose pull).
      2. Confirm the `runner` service starts and `/health` returns 200.
      3. Set `AGENTA_RUNNER_URL=http://runner:8765` in the env file if not already
         present (it is in the updated compose files by default).
      4. (Optional) Enable durable workspaces: set `AGENTA_STORE_ACCESS_KEY`,
         `AGENTA_STORE_SECRET_KEY`, and (for bundled store) ensure SeaweedFS is up.
         Full reference: link to §Store in `self-host/02-configuration`.
- [ ] Steps (Helm path):
      1. `helm upgrade` with the new chart version. `agentRunner.enabled=true` is the
         default; confirm the runner pod is Ready.
      2. To enable the bundled store: `store.seaweedfs.enabled=true` +
         `store.accessKey`, `store.secretKey`. Or point at external S3.
         Full reference: link to §Store in `self-host/02-configuration`.
- [ ] "What changes" note: agent runs now use durable working directories that survive
      sandbox teardown; prior agent runs that used ephemeral sandboxes are unaffected.
- [ ] Tone check: no em dashes, no "simply", "easily", "powerful". Conditional
      imperatives: "If you use Helm, do X."

## 6. Verify and cross-link

- [ ] Confirm all internal links in edited pages resolve (use repo-relative MDX link
      format, not absolute URLs).
- [ ] Check that `07-deploy-the-agent-runner.mdx`, `08-custom-agent-runner-images.mdx`,
      `09-agent-daytona-sandboxes.mdx` use final post-W5 env names. If they still
      use `AGENTA_AGENT_RUNNER_*` or `sandbox-agent`, update them here.
- [ ] Add a "Related" or "See also" link in `07-deploy-the-agent-runner.mdx` pointing
      to the new upgrade note.
- [ ] Run the docs build (`pnpm build` or `npm run build` in `docs/`) and fix any MDX
      or broken-link errors.

## Out of scope (this worktree)

- E2B, Modal provider docs.
- Sandbox metering / credits docs.
- `docs/docs/reference/api/` auto-generated files.
- Codex / OpenCode harness docs.
- Multi-mount-per-run runner docs.
- The architecture diagram rewrite (only additive edits — no full restructure of
  `01-architecture.mdx`).
