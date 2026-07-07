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
   card.
2. Give canonical entries a sensible drill-in (not the raw JSON editor).
3. Make canonical entries participate in the add/remove flows: they count as "already
   added" for the same action + connection, and removal handles both shapes.
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
