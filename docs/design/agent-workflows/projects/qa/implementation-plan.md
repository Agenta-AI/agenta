# Agent-workflows QA: consolidated implementation plan

One page that turns the QA findings and the four design proposals into a sequenced plan. Each
proposal is Codex-reviewed; the full docs are linked. The point of this page is the order and
the one decision that gates the rest.

Source proposals:
- Skills config: [skills-config/proposal.md](../skills-config/proposal.md)
- Model config: [model-config/proposal.md](../model-config/proposal.md)
- Harness capabilities + MCP-on-Pi: [harness-capabilities/proposal.md](../harness-capabilities/proposal.md)
- Code-tool sandbox: [code-tool-sandbox/proposal.md](../code-tool-sandbox/proposal.md)

## Already done (verified live)

- **F-001** Pi `system`/`append_system` on sandbox-agent: fixed (writes `SYSTEM.md`/`APPEND_SYSTEM.md`
  into the per-run agent dir), reviewer-approved, live-verified. Pending: port the delta to
  PR #4778.
- **F-002** stale `ground-truth.md`/`status.md`: corrected.
- **F-005 / F-006** stale extension bundle + missing python3 in the runner: fixed and pushed
  (PRs #4776/#4778).

## Batch A: the low-risk batch (no security surface, kills the silent no-ops)

Recommended to green-light as one unit. None of it changes the trust model.

1. **Two one-line bug fixes** (independent, do first):
   - **F-012** `secrets.py`: `together_ai` must map to `TOGETHER_API_KEY` (today `TOGETHERAI_API_KEY`); verify `mistralai`/`groq`/`openrouter` while there.
   - `allowedModels()` reads the wrong field (`c.id` vs `c.value`), returns empty today.
2. **Harness capabilities table + fail-loud** (the unifying piece). A static per-harness
   capability table in a new SDK module `capabilities.py`, read by the schema, `inspect`, and
   the backend. The backend rejects a non-empty unsupported field before the run starts
   instead of silently dropping it. This is the smallest slice that closes the silent-no-op
   class behind **F-007** (model) and **F-009** (MCP). Escape hatch: `AGENTA_AGENT_MODEL_STRICT`,
   opt-in first so the playground default does not break.
3. **Pi `auth.json` on the sandbox-agent path** so a requested model actually applies (**F-007** core).
   The runner writes an env-interpolated `auth.json` (no raw secrets on disk, 0600) into the
   per-run agent dir, local and Daytona, derived from the request's resolved keys. Note Pi's
   Codex login is a separate provider (`openai-codex`).
4. **MCP on Pi** (**F-009**). Extend the Agenta Pi extension we already install every run to
   connect the resolved MCP servers and `registerTool` each tool, then flip Pi's `mcpTools`
   on. Servers ride the extension env, never a secret-laden file on disk. Converts MCP from
   "Claude-only" to "works on pi/agenta too."
5. **Curated skills** (**F-003**, step 1). Add `skills: List[SkillConfig]` to the neutral
   config with the `curated` variant only (reference a platform skill by validated name). No
   new wire, no new execution surface. Closes the common "let users pick a skill" case.
6. **`inspect` capabilities map + frontend field-gating** (`AgentConfigControl`) + static model
   choices (**F-007** part 3, layer 1). Surfaces the capability table so the UI shows or hides
   `mcp_servers`, the model picker, and skills per selected harness.

## Batch B: gated on the one decision

**The decision: are code tools meant to run on a shared multi-tenant cloud, or
single-tenant/self-host?** (See code-tool-sandbox/proposal.md.) Author `code` always runs in
the shared `sandbox-agent` runner today, never the per-session sandbox. Secrets are walled; the
risk is network/filesystem/sibling-tenant interference on a shared runner only.

- **If single-tenant/self-host:** nothing to do for **F-010**. Then **inline skills**
  (**F-003** step 2: author-provided SKILL.md + scripts) can ship behind the same trust
  boundary as code tools.
- **If shared multi-tenant cloud:** **F-010** needs a real jail before code tools or inline
  skills are safe: option 3 (harden the runner child: net-deny, namespaces, seccomp, cgroups,
  output caps, separate UID) as the floor, or option 4 (per-tenant isolated workers), with
  option 2 (run in the Daytona sandbox) where a separate-kernel boundary is required. Inline
  skills wait on this.

## Deferred / verify

- **F-008** skill script path: downgraded to verify-only (Pi 0.79.4 likely already resolves
  it). Re-run the with-code skill test; fix only if it fails.
- **F-011** no-auth Composio toolkits: deferred (OAuth toolkits cover real use).

## Suggested order

Batch A (1 → 6) in that order. It is all low-risk and removes every silent-no-op the QA found.
Then take the multi-tenant decision and do the matching half of Batch B. Land each piece in the
relevant agent-workflows PR.
