# Gateway connection rework

An agent can use tools from an outside product, for example GitHub or Slack. Today each
tool is one saved entry in the agent configuration. This project replaces those per-tool
entries with one entry per connection, gives the model two runtime tools instead of many,
and moves permission from a routing string into structured private data.

## Reading order

Read the three design documents first. They are decided. The plan implements them and does
not change them.

1. [data-model.md](data-model.md). The saved `gateway_connection` entry, the four
   permission values, validation, and migration from the per-tool format.
2. [runtime-tools.md](runtime-tools.md). The two model-facing tools `search_tools` and
   `run_tool`, their input and output shapes, and the prompt guidance.
3. [permission-layers.md](permission-layers.md). Who stores policy, who compiles it, who
   enforces it, and how a call reaches the provider.

Then read the working documents.

4. [context.md](context.md). Why this work exists and what it does not cover.
5. [contracts.md](contracts.md). The exact shared shapes between Python, TypeScript, and
   the API. Every slice reads this file before it writes a field name.
6. [plan.md](plan.md). Seven implementation slices in dependency order.
7. [research.md](research.md). What the current code does, with file and line references.
8. [qa.md](qa.md). Every test this project must pass, each with an ID. The plan's slices
   point at those IDs instead of restating them.
9. [release-gate-changes.md](release-gate-changes.md). How the standing agent release gate
   should change to cover gateway tools.
10. [status.md](status.md). Progress.

## Words used in these documents

**Gateway.** The part of the platform that reaches outside products. Composio is the only
gateway provider today.

**Provider.** The company or service that fronts many outside products. Value: `composio`.

**Integration.** One outside product behind the provider. Values: `github`, `slack`,
`gmail`. Composio calls this a toolkit.

**Connection.** One authenticated account for one integration, saved on the project. It has
a slug, for example `github-work`. Several agents can share one connection.

**Tool key.** The stable Agenta name for one action of an integration, for example
`GET_ISSUE`. The saved permission map uses tool keys.

**Provider action ID.** The provider's own name for the same action, for example
`GITHUB_GET_ISSUE`. It stays inside the API.

**Catalog.** The list of integrations and their tools, read from the provider and cached by
the API.

**Runner.** The TypeScript service at `services/runner`. It drives the model turn, enforces
permission, and asks a person for approval.

**Harness.** The coding agent the runner drives inside the sandbox. Claude Code, Codex, and
Pi are harnesses.

**Sandbox.** The isolated machine the harness runs in. It never holds credentials.

**Resolver.** The Python code that turns saved configuration into runner-ready tool
specifications at run start.

**Compiler.** The new pure Python function that turns saved permission policy plus catalog
metadata into one `allow`, `ask`, or `deny` value per tool.

## Rules for this project

- Touch as few files as possible.
- Reuse what exists. The Sessions interaction machinery, the `ConnectDrawer` connect flow,
  the API catalog cache, and the `CatalogChooser` component all stay.
- Do not add an abstraction for a case the design does not describe.
- Do not put policy in a name or a routing string.
