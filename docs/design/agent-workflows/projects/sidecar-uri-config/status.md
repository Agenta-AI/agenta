# Status

## State

- **Design only.** No code changed. This workspace is the proposal spun out of PR #4821 review
  comment [3469613625](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469613625).
- Research complete and verified against the working tree (2026-06-24): the routing seam
  (`select_backend`), the env fallback (`runner_url` / `runner_dir`), the `RunSelection` vs
  `AgentConfig` split, the schema, and the proof that `uri` is not a `/run` wire field.
- The plan and the security restriction are written. Awaiting the reviewer's decisions on the
  open questions below before any implementation slice.

## Decisions taken (in this design)

- **D1 — `uri` lives on `RunSelection`, not `AgentConfig`.** It is *where a run goes* (like
  `sandbox`), not *what the agent is*. The neutral config stays address-free.
- **D2 — Not a `/run` wire field.** `uri` is consumed entirely service-side in `select_backend`;
  the runner never receives it. Golden wire fixtures stay byte-identical.
- **D3 — Precedence: `selection.uri` (validated) → `AGENTA_AGENT_RUNNER_URL` → local CLI.** Unset
  `uri` is exactly today's behavior, so the env-var path is the fallback the reviewer asked for.
- **D4 — A caller-supplied address is gated by a server-side allowlist, default-off.** The field
  is inert until an operator opts in. A rejected override fails loud (no silent fallback). This is
  the load-bearing security decision; see [security.md](security.md).
- **D5 — No back-compat / migration.** Pre-production; the env fallback is the right default, not
  a compatibility shim.

## Open questions (for the reviewer to comment on)

- **O1 — Allowlist as the gate: agree?** The design requires `AGENTA_AGENT_RUNNER_URI_ALLOWLIST`
  (default empty = every override rejected) before a caller-supplied `uri` is trusted, because
  the service ships resolved secrets + bearer tokens to whatever URL it picks. Is a server-side
  allowlist the right control, or do you prefer a different gate (e.g. role-restricted, or
  operator-only with no client path at all)?

- **O2 — Is loopback implicitly allowed?** Should `127.0.0.1` / `localhost` be honored without
  being listed (common single-host dev convenience), or must even loopback be in the allowlist so
  the default is uniformly "nothing trusted"? Leaning: require it to be listed.

- **O3 — Playground-visible or API-only?** A routing override is an operator/testing concern, not
  a normal authoring field. Options: (a) hide it from the playground entirely (API-only),
  (b) show it behind an "advanced" toggle, (c) show it normally. Leaning: API-only or advanced.
  The server-side allowlist is required regardless, because a direct API caller bypasses the form.

- **O4 — Reject vs silent fallback on a disallowed `uri`.** The plan errors (4xx) on a rejected
  override rather than falling back to the env var, to avoid allowlist-probing and to surface
  misconfiguration. Confirm this is the wanted behavior.

- **O5 — Name of the field and the env var.** `uri` (matching the reviewer's wording and the
  artifact `workflow.slug`/`uri` grammar already used elsewhere) on the config;
  `AGENTA_AGENT_RUNNER_URI_ALLOWLIST` for the gate. Alternative field names considered:
  `runner_url`, `sidecar_uri`. Confirm `uri`.

## Coordination

- Lane: `docs/sidecar-uri-config` (DOCS-ONLY, new dir only), based on `big-agents`, PR to
  `big-agents`. Single commit of the five files in this directory. Did not touch any shared file,
  the board's other rows, or any code.
- Sibling projects this references but does not edit:
  [sidecar-deployment-proposal](../sidecar-deployment-proposal/) (default deployment contract) and
  [sidecar-trust-and-sandbox-enforcement](../sidecar-trust-and-sandbox-enforcement/) (transport
  trust; the allowlist here complements its step-1 network-isolation assumption).

## Next steps

1. Reviewer comments on O1–O5 in the PR.
2. Once the security posture is confirmed, an implementation slice per [plan.md](plan.md):
   the `RunSelection.uri` field, the `AgentConfigSchema` field, `resolve_runner_url` /
   `validate_runner_uri` + the env var, the `select_backend` preference, tests, and the
   keep-docs-in-sync interface updates — all in one PR (field + allowlist ship together).
