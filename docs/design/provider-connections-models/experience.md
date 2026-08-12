# Interface specification

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

This file records the founder-provided interface design for model providers. The source is the
clickable prototype [`model-providers-ux-prototype.html`](model-providers-ux-prototype.html) and its
handoff notes from 2026-08-12. The design decisions in this file come from the founder and outrank
the agent-inferred parts of this folder. Open the prototype in a browser to click through the flows.

The prototype is a sketch, not reference code. Implementation must use the real Agenta design
system: Ant Design 6 components, the v0.112.0 warm palette, Inter, and provider logos from
`LLMIconMap` in `@agenta/ui`. Do not port the prototype's markup, styles, state management, or data
structures. Known prototype shortcuts that must not be replicated: initials instead of provider
logos, a simulated key test, hardcoded model lists, no persistence, only three hardcoded harnesses,
and hand-rolled drawer and table markup instead of Ant `Drawer` and `Table`.

## Naming

Use one term everywhere: "Model providers". It appears in the playground banner call to action, the
model picker footer, the drawer title, and the Settings tab. Rename the Settings tab from "LLMs"
(`web/oss/src/components/pages/settings/assets/navigation.ts`).

## Model picker in the playground

The closed picker pill shows the selected model, a harness tag, and the effort level. A harness is
the program that communicates with a model and uses tools, such as Pi, Codex, or Claude Code.

- First run with nothing connected: the pill is dashed and reads "Set up model providers". Clicking
  it opens the provider drawer directly.
- Open picker, level 1: a list of connections, not vendors. A subscription and an API key are
  separate entries, for example "Claude subscription" and "Anthropic". Each row shows the provider
  icon, the name, and the model count. When a provider has more than one connection, the row shows
  the connection name.
- Hovering a connection row opens a side flyout, following the existing platform pattern. Click and
  the right-arrow key also open it for touch and keyboard use.
- The flyout lists models flat, one row per model and harness pair. The harness appears as a
  neutral tag. When the same model is reachable through several connections or harnesses, each row
  adds a one-line cost hint: subscription access has no per-token cost, API access is metered per
  token.
- A search field at the top searches models across all connections and shows flat results with the
  connection as a subtitle.
- Footer rows: the effort selector and an "Add provider" row that opens the drawer.
- The first time a user sees harness tags, show a dismissible one-line explainer.

## Provider drawer

One drawer component serves two entry contexts.

From the playground, the drawer shows three sections:

1. Connected: each connection with name, masked key, harness tags, and a status dot.
2. The full provider catalog.
3. Subscriptions.

The playground drawer footer shows the connected count and a "Manage in Settings" link.

From Settings, the "Add provider" button opens the same drawer showing the catalog only, titled
"Add a provider". It has no Connected section and no subscription rows. One footer note explains
that subscriptions are configured in the deployment, not added here, and links to the docs.

Catalog rules:

- The catalog lists the full standard provider list from
  `web/packages/agenta-shared/src/utils/llmProviders.ts`. That is 13 providers today, in code
  order, with real logos. Never truncate the list into an "N more" row.
- "OpenAI-compatible endpoint" appears as the last row and starts a custom provider connection.
- The catalog is searchable.
- A provider that is already connected still offers "Add", not "Configure", because several
  connections per provider are allowed.

## Provider connection card

Selecting a provider pushes a connection card inside the drawer. No modals. The same card opens
from the Settings table rows.

1. API key field with a Test button. Test validates the credential and fetches the model catalog in
   one action. The card states "Nothing is saved until Done" and "Encrypted at rest".
2. Name field, labeled optional. An empty name receives the API-assigned display name: the provider
   title first, then the title plus a number, such as "OpenAI 2".
3. Active models section, titled "Active models: x of N". It appears only after a valid key. It has
   an inline search, Select all, and Clear. Recommended models are pre-checked and tagged
   "recommended", never "default". A timestamped line such as "Fetched 2 min ago" offers re-fetch.
4. Harnesses section, collapsed by default, always showing its value, for example "Harnesses: runs
   in Pi". Checkboxes list each harness. Pi is the default for API keys. Each checked harness adds
   its own model rows to the picker.
5. Footer: Cancel and Done. Done stays disabled until the key is valid. A back arrow appears only
   when the card was pushed from a list.

Error path: when the provider rejects the key, show inline red text that names the source, for
example "OpenAI rejected this key (401)". The field stays editable, the button becomes Retry, Done
stays disabled, and the card repeats that nothing has been saved. No toasts.

Key deletion is not on this card. It lives in the Settings row actions as "Remove key".

Two provider behaviors need decisions before this card is final. Some providers offer no free
credential test, so a literal "Done disabled until the key is valid" would block them forever. And
saving the pre-checked recommended set as an explicit list pins the connection to today's
recommendations. Both are recorded in [status.md](status.md) as open decisions.

## Subscriptions

Subscriptions (Claude, ChatGPT) are configuration-only. The user sets them up by mounting the
provider folder, such as `~/.claude` or `~/.codex`, in the self-hosted deployment. The UI never
offers a subscription form.

- Detected subscription (reported by the runner): the card shows the plan, the mount, read-only
  harness chips labeled "set in your deployment config" with a docs link, and an editable model
  shortlist. The shortlist is fixed by the plan and has no fetch or refresh. There is no validate
  action. A failing subscription surfaces as a run error in the playground.
- Not detected, or running in cloud mode: a disabled row. The whole row is the click target and
  leads to the self-hosting guide.

Where the edited shortlist persists is an open decision recorded in [status.md](status.md), because
a subscription is runtime state, not a vault record.

## Settings page

The Settings tab "Model providers" shows a table of connected providers only:

| Column | Content |
| --- | --- |
| Provider | Logo and name |
| Credential | Masked key, or "Detected · Max" for a subscription |
| Active models | Count, such as "2 of 38 active" |
| Connected | Date, or "Auto-detected" for a subscription |

Clicking a row opens the same connection card. One primary "Add provider" button opens the catalog
drawer. The empty state appears inside the table with the same button. A footnote under the table
explains runner-detected subscriptions.

## Visual source of truth

The Agenta design system: warm ink and paper palette, the six-slot tag colors with olive for
Subscription and neutral for harnesses, Inter, and Ant Design 6 components. Higher-fidelity static
comps exist in the design project under "Model Setup Hi-fi".
