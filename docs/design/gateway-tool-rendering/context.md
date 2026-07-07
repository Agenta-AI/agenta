# Context

## Why this work exists

Builder agents (and the SDK) author connected-app tools in the **canonical persisted
shape** — a discriminated `type:"gateway"` object:

```json
{
  "type": "gateway",
  "provider": "composio",
  "integration": "slack",
  "action": "OPEN_DM",
  "connection": "slack-pnt",
  "permission": "allow"
}
```

The playground UI cannot render that shape. It only recognizes the **legacy encoding it
writes itself** — an OpenAI-style function tool whose `function.name` is the gateway slug
`tools__{provider}__{integration}__{action}__{connection}`:

```json
{
  "type": "function",
  "function": {
    "name": "tools__composio__slack__OPEN_DM__slack-pnt",
    "description": "…",
    "parameters": { "…": "…" }
  }
}
```

Both are equivalent server-side. The SDK compat layer converts legacy → canonical, and
the resolve path re-enriches description + input schema from the live catalog at run
time. The agent's config is correct and runs. **This is purely a frontend read-path
gap.**

## The symptom (real, hit by Mahmoud)

An agent authored three Slack tools in the canonical shape. In the playground Tools
section they rendered as:

- Three rows named **"gateway"**, tagged **"built-in"**, grouped under a single
  **BUILT-IN** header (not under a Slack connected-app card).
- Each drill-in opened a **raw JSON editor** with a header reading "Gateway", instead of
  a connected-app detail view.

The expected rendering (what the legacy encoding gets today):

- Each row named by its **humanized action** ("Open DM"), with a Slack monogram/logo and
  a `slack` tag.
- Grouped under a collapsible **Slack** card inside a **Connected apps** sub-section.
- Drill-in shows the integration / action / connection identity, not a raw JSON blob.

## Goals

1. Render canonical `type:"gateway"` tools identically to the legacy encoding: correct
   name, avatar, tag, "Connected app tool" subtitle, and grouping under the provider
   card. The product invariant is that a tool looks the same regardless of who authored it.
2. Route a canonical drill-in to the **existing** gateway view (not the raw JSON editor,
   not a new component), populated by a catalog fetch. Fail safe to raw JSON plus a warning
   only when the tool cannot be resolved.
3. Make canonical entries participate in the drawer's **add** path: they count as "already
   added" for the same action + connection so they cannot be added twice, and toggling one
   off removes the matched entry. The frontend does not deduplicate.
4. Route every consumer through **one shared shape-detection helper** so the descriptor,
   the list grouping, the drill-in, and the drawer all agree.

## Non-goals

- **No backend changes.** The resolve path and catalog endpoints already exist and are
  correct.
- **No SDK wire changes.** `GatewayToolConfig` and the compat layer already accept both
  shapes; we do not touch them.
- **No new endpoint.** The catalog action-detail endpoint
  (`GET /tools/catalog/providers/{p}/integrations/{i}/actions/{a}`) already exists if we
  choose to enrich the drill-in.
- We are **not** forced to migrate existing legacy-encoded tools. Both shapes keep
  working; convergence (start writing canonical on add) is an open question, not a
  requirement.

## Standing constraints

- **Normalize on the frontend read path** — the sanctioned fix class for FE/BE shape
  mismatches (Mahmoud's standing rule).
- **Agent-guidance / rendering fixes land at the FE/SDK layer, never in the core API or
  harness.**
- The working tree carries **uncommitted secret-isolation design edits** in sibling
  files (`connectionUtils.ts`, `ProviderCredentialsSection.tsx`, `useModelHarness.tsx`,
  and others under `SchemaControls/agentTemplate/`). This design **must not require
  touching those files**, and the implementation must not modify them. The changes here
  are confined to the tool read-path modules listed in [research.md](research.md).

## Review round — 2026-07-07 (decider: Mahmoud)

Mahmoud reviewed the draft plan on PR #5140 and folded five decisions into the design.

1. **Product invariant leads (was Question 1).** Rendering and grouping are implementation
   detail. From a product view nothing changes: the playground tool UI looks exactly the
   same before and after, and an agent-created tool looks exactly like a UI-created one. The
   shared parser is the simplification mechanism, not a product change. The only visible
   divergence anywhere is the fail-safe (decision 4).
2. **Drill-in data = Option B (closes open question #1).** Fetch the catalog detail. The bar:
   tools show EXACTLY the same for UI-created and agent-created, both in the outside list and
   in the drill-in.
3. **The frontend does not deduplicate (was Question 3).** Showing what exists, including
   duplicates, is correct. The frontend's only identity responsibility is the add path: show
   a tool as already added so it cannot be added twice; toggle-off removes the matched entry
   only. No display-dedupe, no removal-dedupe.
4. **Reuse the existing drill-in view (was the `GatewayToolDetailView` proposal — rejected).**
   "We already have a view for opening tools in the drawer. We should not change it."
   Canonical entries open the SAME existing gateway view legacy entries get, populated via
   the Option-B fetch. **New requirement:** when the catalog fetch fails or the action cannot
   be confirmed to exist (an agent wrote a nonexistent tool), fail safe to the raw JSON view
   as today, plus a warning that the tool could not be resolved.
5. **Convergence deferred (closes open question #2).** "I would not change the logic for
   now." The drawer keeps writing the legacy shape on add. Read-side canonical support is
   unaffected.
