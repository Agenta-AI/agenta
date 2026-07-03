# Status

Source of truth for where this work stands. Keep it current.

## State

**PLANNED, not built.** This is a docs-only planning workspace created on 2026-07-02. No code has
changed. All five gaps and their file references were re-verified on 2026-07-02 against the working
tree. The plan sits on top of two siblings: `provider-model-auth` (BUILT, PR #4815) and
`model-config` (DESIGNED, not built).

Last updated: 2026-07-02.

## Decisions

- **A known-direct custom provider is `deployment="direct"`.** Normalize it at resolve time in
  `_custom_provider_candidate`, so its key injects exactly like a `provider_key`. The base URL
  rides the orthogonal `endpoint` field, which already reaches the runner. This is the smallest
  correct fix and needs no wire change.
- **`deployment` is a closed access-surface enum**, not an echo of the vault record kind. Values:
  `direct`, `azure`, `bedrock`, `vertex`. A custom endpoint is `direct` plus an `endpoint`; the
  free `"custom"` value is dropped.
- **The runner derives Pi `auth.json`/`models.json`** from `resolved_connection` plus `secrets`.
  The credential is always a `"$ENV"` reference, never a raw value on disk. No new wire field.
- **Fail loud is staged.** `AGENTA_AGENT_MODEL_STRICT` defaults `false` first (warn and fall
  back), then flips to `true` after the QA matrix confirms the common models are settable. A
  no-model-requested run always uses the harness default and is never an error.
- **The picker reads two sources kept distinct**: the static harness catalog (service config) and
  the project vault's custom-provider models (project data), joined under the harness reachability
  filter. `VaultConnectionEntry` gains `models?: string[]`.
- **Slice 1 is the fastest unblock** and ships first after the Slice 0 one-liner.

## Open decisions (do not block the plan)

- **Where the deployment normalization lives.** The lean is to normalize a known-direct
  `custom_provider` to `deployment="direct"` at resolve time (Slice 1). The alternative, gating it
  differently in the harness check (treating a known-direct kind as allowed), was rejected because
  it would leave a routing field carrying a provider name and push provider knowledge into the
  capability gate. Confirm the resolve-time normalization is acceptable to the `provider-model-auth`
  owner, since it changes that project's `_custom_provider_candidate`.
- **How Slice 4 reads the vault.** Client-side (the vault is already fetched on the picker screen
  via `vaultSecretsQueryAtom`, so no new endpoint) versus a new per-project model list on a server
  inspect field. The lean is client-side, consistent with `provider-model-auth`'s "the frontend
  intersects the capability table with the vault." A server field would be needed only if a
  non-browser caller must discover the per-project set.
- **Whether to close the `deployment` enum in the same slice** as the normalization, or to
  normalize first and tighten the type in a follow-up. Tightening the type may touch call sites
  beyond this project.

## Risks

- The deployment change is in `provider-model-auth`'s resolver
  (`sdks/python/agenta/sdk/agents/platform/connections.py`), a file that project owns. Coordinate
  before editing; the change is one line plus the enum tightening, but it belongs in a coordinated
  lane.
- The provider-to-env map is duplicated across three files and has already drifted on `minimax`.
  The Slice 0 fix must touch all three and should add the cross-copy equality test the siblings
  deferred.
- Slice 2 lands in the runner, which multiple sessions edit. The runner path moved to
  `services/runner/src/` and the functions split across `sandbox_agent/` submodules, so any stale
  `services/agent/src/` reference in a sibling doc or test will miss.
- Flipping `AGENTA_AGENT_MODEL_STRICT` to strict can fail runs that echo the advertised default
  `gpt-5.5` on a backend where it is not settable. Reconcile the advertised default with the
  per-harness settable set before flipping (Slice 3b gate).

## Non-goals

- Bedrock, Vertex, and Azure consumption on Pi stays fail-loud.
- No vault storage change, no migration, no `/secrets` write path.
- No new `/run` wire field.
- The prompt/completion path is untouched.

## Next steps

1. Coordinate the Slice 1 resolver change with the `provider-model-auth` owner.
2. Land Slice 0 and Slice 1 (the two smallest, highest-value changes).
3. Build Slice 2 in the runner, with local and Daytona parity, then Slices 3 and 4.
4. Verify on the live matrix: a custom OpenRouter connection with a built-in id (Slice 1) and with
   a genuinely custom id and base URL (Slice 2), and a Together key (Slice 0).
</content>
