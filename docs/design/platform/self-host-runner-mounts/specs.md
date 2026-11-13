# Self-host docs — runner + mounts — specs

> Status: **draft**. Scoped to W7 (`docs/self-host-runner-mounts`). Design-only —
> no MDX pages written here. Grounded in the audit at
> `big-agents-audit/platform-readiness-big-agents-now.md` §Docs (MDX) and §Mounts.

## Problem / what's missing

The existing self-host MDX tree has three new guides (07/08/09) that cover the
runner itself, custom images, and Daytona sandboxes. The infrastructure and
top-level pages were written before the runner sidecar and the durable object
store existed. Three gaps:

1. `self-host/infrastructure/01-architecture.mdx` — the architecture diagram and
   component list omit the runner sidecar entirely. The worker list inside
   `01-architecture.mdx` omits `worker-records`.
2. `self-host/infrastructure/02-networking.mdx` — no mention of the runner's
   internal port (`:8765`) or of SeaweedFS (`:8333`); the internal-communication
   table is incomplete.
3. `self-host/02-configuration.mdx` — has an "Agent runner" section and a "Mounts
   (durable object store)" section, but both use pre-rename names
   (`AGENTA_AGENT_RUNNER_*`, `SANDBOX_AGENT_*`, `AGENTA_MOUNTS_STORAGE_*`) that
   will not match once W5 (runner-rename) and W6 (store-generalization) land.
   Additionally, there is no Helm `values.yaml` equivalent for the store vars once
   the rename produces `AGENTA_STORE_*`.
4. No upgrade note exists for self-hosters who were running Agenta before the
   runner and store shipped.

## Decisions

### Naming — use final post-rename names throughout

Docs land after W5 (runner-rename) and W6 (store-generalization), or are written
to final names and stitched by the local integration PR. Either way docs must use:

- Runner-infra vars: `AGENTA_RUNNER_URL`, `AGENTA_RUNNER_PORT`, `AGENTA_RUNNER_HOST`,
  `AGENTA_RUNNER_IMAGE_NAME`, `AGENTA_RUNNER_IMAGE_TAG`, `AGENTA_RUNNER_TOKEN`
  (post-W5 renames from `AGENTA_AGENT_RUNNER_*`).
- Agent-behaviour vars stay `AGENTA_AGENT_*`: `AGENTA_AGENT_MCPS_ENABLED` (renamed
  from `AGENTA_AGENT_MCP_SERVERS_ENABLED` per W5), `AGENTA_AGENT_API_URL` (renamed
  to `AGENTA_RUNNER_API_URL` at the runner level), `AGENTA_AGENT_SANDBOX_PI_INSTALLED`.
- Sandbox provider: `SANDBOX_AGENT_PROVIDER` — keep as-is pending final name decision
  in W5 (it's "borderline" per the audit; docs note it reads on the runner).
- Store vars: `AGENTA_STORE_ENDPOINT_URL`, `AGENTA_STORE_ACCESS_KEY`,
  `AGENTA_STORE_SECRET_KEY`, `AGENTA_STORE_REGION`, `AGENTA_STORE_BUCKET`,
  `AGENTA_STORE_SIGNING_KEY` (post-W6 renames from `AGENTA_MOUNTS_STORAGE_*`).
- Helm store block: `store.endpointUrl`, `store.accessKey`, `store.secretKey`,
  `store.region`, `store.bucket`, `store.signingKey`, `store.seaweedfs.enabled`.
- Service name: `runner` (post-W5, replaces `sandbox-agent`); in-cluster URL becomes
  `http://runner:8765`.

### Infrastructure pages — additive edits, not rewrites

`01-architecture.mdx` and `02-networking.mdx` are narrative Explanation pages. The
edits add the runner sidecar and store to the existing diagram prose and tables; they
do not restructure the pages. Style: declarative, no marketing language, active voice
(per write-docs §2). Do not add narrative inside reference tables.

### Configuration page — update two sections in place

The "Agent runner" and "Mounts (durable object store)" sections in
`self-host/02-configuration.mdx` are Reference in Diátaxis terms. Update the table
rows to the final env-var names, add missing Helm paths for the store block, and
correct the `values.yaml` paths to match the post-W6 Helm keys (`store.*`). The
existing admonitions (SeaweedFS signing key note, remote-sandbox warning) remain but
need their var names corrected. The `worker-records` Redis stream is not in the
configuration page scope — it's a deployment detail for the networking/architecture
pages.

### Upgrade note

A short how-to (Diátaxis: How-to) at `self-host/upgrades/` telling an existing
self-hoster how to enable the runner and store on a deployment that predates the
big-agents branch. Steps: pull the new image tags, confirm the runner container
starts (`/health` returns 200), set the `AGENTA_STORE_*` block if agent durable
workspaces are wanted. Keep it short — one page, no rationale. Link out to 07 and
the configuration reference.

### SeaweedFS and the bundle-or-external toggle

`seaweedfs.enabled` in the Helm chart mirrors `postgresql.enabled`. When `true` the
chart bundles a SeaweedFS StatefulSet; when `false` the operator points
`store.endpointUrl` at an external S3-compatible store (AWS S3, R2, MinIO). Document
this toggle in the architecture page (one paragraph) and in the configuration page
(table note). Per-tier store decisions:

- Compose (local/self-host gh): SeaweedFS container bundled.
- Railway: SeaweedFS service + volume (public domain, no ngrok).
- Kubernetes: operator's choice via `seaweedfs.enabled`.
- Live / private cloud: external AWS S3 (`seaweedfs.enabled=false`, empty endpoint).

### ngrok — mention only where relevant

`ngrok = (sandbox is remote) AND (store is private-only)`. This means compose-local
running Daytona sandboxes only. Mention it in the networking page (one sentence,
`remote` compose profile) and in the remote-sandboxes admonition in the configuration
page. Do not mention ngrok on Railway, Kubernetes, or live deployments.

### worker-records

Add `worker-records` to the worker list in `01-architecture.mdx` alongside the
existing `worker-evaluations`, `worker-tracing`, etc. One line. No deep description.

## What the MDX prose must follow (write-docs guidance)

The write-docs skill (`vibes/.claude/skills/write-docs/SKILL.md`) governs the MDX
prose the implementation agent writes. Key constraints for this scope:

- Infrastructure pages are **Explanation** (Diátaxis). Lead with the model; one worked
  example beats three abstract paragraphs. End with links to the how-tos.
- Configuration page section is **Reference**. Tables, one-line descriptions. No
  narrative. Dry on purpose.
- Upgrade note is a **How-to**. Title = reader's goal. Only actions. No rationale.
- Tone: Docker/Stripe reference tone. Active voice, short sentences.
- No em dashes. No marketing words ("powerful", "seamlessly", etc.).
- Customer-facing vocabulary: "agent runner", "durable store", "sandbox provider" — not
  internal code names ("sandbox-agent", "geesefs", "STS").

## Dependencies (docs land after these)

- **W5 (chore/runner-rename)** — finalises `AGENTA_RUNNER_*` env names and the `runner`
  service name.
- **W6 (chore/store-generalization)** — finalises `AGENTA_STORE_*` env names and
  `store.*` Helm paths.
- **W4 (feat/mounts-nondev-wiring)** — lands Railway SeaweedFS service + Helm
  `values*.example.yaml` store block. Docs can be written to final names and merged
  once W4 is in; the integration PR stitches any residual name diffs.

## Out of scope

- E2B provider docs (E2B not on `big-agents` branch yet).
- Modal provider docs (not on branch).
- Sandbox metering / credits docs.
- `docs/docs/reference/api/` auto-generated files (never touch manually).
- Codex / OpenCode harness docs.
- The multi-mount-per-run runner story (runner-scalability; not yet shipped).
