# Status

Source of truth for where this work stands. Keep it current.

## State

**PLAN REVISED 2026-07-14 after code review. Partly built.** The plan was created on 2026-07-02.
Three of its original slices have since landed in the codebase, and six review comments on 2026-07-14
reshaped the rest. The remaining work is three slices (service, runner, frontend). It still sits on
top of `provider-model-auth` (BUILT, PR #4815) and `model-config` (partly built).

Landed since 2026-07-02 (verified against the working tree, file references in
[research.md](research.md)):

- The env-var maps collapsed into one canonical `PROVIDER_ENV_VARS` (`capabilities.py:111-125`), with
  a parity regression test. (Old Slice 0.)
- A known-family custom connection resolves to `deployment="direct"` and passes Pi's gate
  (`connections.py:330-335`). (Old Slice 1, known-family case.)
- The runner fails loud on an unsettable model: strict is wired for every harness and defaults to
  true (`sandbox_agent.ts:374`), `allowedModels` reads `c.value ?? c.id` (`model.ts:72`), and
  `applyModel` raises a typed `ModelNotSettableError` (`model.ts:9`). **Divergence from the plan:**
  the code shipped strict-by-default directly, not the staged default-false-then-flip rollout the
  first plan described. The planned "Slice 3b flip" is therefore moot.

Last updated: 2026-07-14.

## Decisions (six review dispositions, all accepted 2026-07-14)

1. **A named OpenAI-compatible connection, not a known family disguised as custom.** Keep
   `deployment="custom"` for a record whose kind is not a known family, default a provider-less
   record to the OpenAI-compatible family after the trusted vault record resolves, and let Pi's
   capability table allow the `(custom, openai-compatible)` pair. Why: the known-family `direct`
   normalization that landed does nothing for an arbitrary kind like `ollama`, which is the actual
   requirement. The known-family case stays as it landed.
2. **Key `models.json` by the connection slug, not `resolved_connection.provider`.** Why: two custom
   connections can resolve to the same family and a provider-less one has no provider id, so the
   provider key would collide or be empty; the slug is unique and stable. This adds `slug` to
   `ResolvedConnection` and its wire form.
3. **Speak `openai-completions` only in v1.** Do not infer `anthropic-messages` from a provider
   label. Why: Anthropic Messages has different request and response semantics. A pure builder exposes
   a protocol discriminator for later dialects; v1 rejects unsupported protocols loudly.
4. **Do not merge the operator `auth.json` into a managed run.** Build an isolated managed Pi
   directory carrying only non-credential settings plus `models.json` with a `"$ENV"` apiKey
   reference. Why: the copied personal login could authenticate a managed run with an operator
   subscription. This also fixes the existing local managed path, which copies `auth.json` today
   (`pi-assets.ts:475-490`) while Daytona already refuses (`daytona.ts:168-171`).
5. **The wire keeps the bare model id; the runner derives `<slug>/<model>`.** The builder returns the
   file content and the exact runtime id, which the runner passes to `setModel`. Why: this bypasses
   the suffix-match fallback (`model.ts:49-59`) that can select the wrong provider.
6. **Cut the picker expansion from this plan; rename the UI type label only.** The picker work moves
   to `model-config` Part 3. Why: the schema/picker change was out of the agreed scope, and the
   `VaultConnectionEntry` symbol the first plan named never existed in `web/`. The UI change here is
   the one rename, "Custom provider" to "OpenAI-compatible endpoint", at three locations.

## Dropped non-goal

- The first plan's non-goal "no new `/run` wire field" is dropped. Keying `models.json` by slug needs
  the slug on the wire. It is replaced by: **exactly one new wire field, the connection slug on
  `ResolvedConnection`.** Everything else the runner still derives.

## Risks

- The wire change touches the provider/model/auth contract from `provider-model-auth` (PR #4815). The
  slug rides `ResolvedConnection.to_wire()`, which the runner mirrors in `protocol.ts` with a shared
  golden fixture. Update both sides and the golden together, and coordinate with that project's owner.
- The runner slice edits `services/runner/src/engines/sandbox_agent/`, which several sessions touch.
  The managed-dir isolation changes the local `pi-assets.ts` copy behavior; verify no non-managed run
  loses its login state.
- Defaulting a provider-less record to the OpenAI-compatible family runs after the vault record is
  trusted. Confirm no untrusted input can reach that default.

## Non-goals

- Bedrock, Vertex, and Azure consumption on Pi stays fail-loud.
- No vault storage change, no migration, no `/secrets` write path.
- Exactly one new `/run` wire field: the connection slug.
- The model picker expansion stays with `model-config` Part 3.
- The prompt/completion path is untouched.

## Next steps

1. Land Slice 1 (service): the slug on the wire, the OpenAI-compatible family default, and the Pi
   `custom` deployment allowance. Coordinate the `ResolvedConnection` change with `provider-model-auth`.
2. Land Slice 2 (runner): the `models.json` builder, the isolated managed dir on local and Daytona,
   and the exact `<slug>/<model>` id.
3. Land Slice 3 (frontend): the type-label rename.
4. Verify on the live matrix: a named OpenAI-compatible connection (custom base URL and custom model
   id) runs on Pi, local and Daytona, and a managed run carries no operator login.
