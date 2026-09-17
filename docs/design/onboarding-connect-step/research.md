# Research

Verified against the tree at `fe-feat/session-deep-links` (2026-08-24). Every claim below
was read from source, not inferred.

## The onboarding paths

Three entry points, all converging on `useCreateAgent`
(`web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts`), which wraps the
shared core `useCreateAgent` from `@agenta/home-ui`.

1. **Free text, on Home.** `StripHome.tsx` renders `StripComposer` on first run;
   `handleCreate` → `useAgentHomeActions.onCreate` → `useCreateAgent` → `router.push` to
   the app playground with a first-run seed that auto-sends.
2. **Free text, playground-native.** `PlaygroundOnboarding/useAgentOnboarding.ts` mints an
   ephemeral agent up front and renders the playground around it. `commit(seedMessage, name)`
   calls `useCreateAgent` with the existing `entityId` and an `onCommitted` callback that
   swaps the entity in place — no redirect. Gated by `PLAYGROUND_NATIVE_ONBOARDING`
   (default on).
3. **Template.** `useCreateAgentFromTemplate` (strip / gallery / template detail) creates
   directly from a card click, named after the template and seeded with
   `templateBuilderMessage(template)`. `useTemplateSelect` is the older two-mode variant:
   builder mode (default) creates directly; flag-off calls `openSetup` → `TemplateSetupDrawer`.

The commit point is therefore singular: **one gate, two mount points** (the Home create
surface and the playground onboarding surface).

## Flag matrix (all in `agent-home/assets/constants.ts`, read via `getEnv`)

| Flag | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER` | on | Template click creates directly. Off → `TemplateSetupDrawer`. |
| `NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING` | on | Onboarding lives inside `/playground` on an ephemeral. |
| `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP` | on | The shared `<TemplateStrip />` is the only template-browsing surface; the setup drawer, gallery grid and quick-pick are bypassed. |

With all three at their defaults, `TemplateSetupDrawer` is unreachable.

## What already exists and is reusable

- **Connections state** — `@agenta/entities/gatewayTool`: `useToolIntegrationConnections`,
  `useToolIntegrationDetail`, `useToolsConnections`, `isConnectionActive`. Connections are
  **workspace-scoped**, not per-agent: connecting during onboarding is a real, durable act
  that any later agent also sees.
- **Catalog search** — `useToolCatalogIntegrations` / `toolIntegrationsSearchAtom` do
  server-side search over the Composio catalog (`fetchToolIntegrations(provider, {search})`),
  cursor-paginated, persisted. This is the primitive for "＋ Search all" and for detection
  strategy S3.
- **The OAuth flow** — `@agenta/entity-ui/clientTools/useConnectFlow.ts`. Creates the
  connection, opens the popup, validates the callback by origin, settles on every terminal
  path. Already handles the auth-scheme resolution trap (a toolkit whose real scheme is
  `api_key` 404s on an `oauth` hint).
- **`ConnectDrawer`** — `@agenta/entity-ui/gatewayTool`, the drawer `IntegrationRow` opens.
- **An integration row** — `agent-home/components/TemplateSetupDrawer/IntegrationRow.tsx`.
  Logo + name + scope + Connect/Connected, wired to the real connection state. Good shape;
  currently app-layer and drawer-specific.
- **Provider catalog** — `PROVIDERS` in
  `web/packages/agenta-entities/src/workflow/agentTemplates.ts`: 22 curated slugs with
  labels and Composio logo URLs.
- **Template-declared integrations** — `template.requiredIntegrations`:
  `{slug, scope, tools[]}`, mirroring each playbook's Connections section in
  `sdks/python/agenta/sdk/agents/adapters/agent_templates/*.py`.

## What the frontend cannot do

There is no frontend-reachable endpoint that maps a natural-language description to
integrations. `discover_tools` is a platform op the *agent* calls, not an HTTP endpoint the
browser can hit. So free-text detection is limited to string matching against the catalog
plus the user correcting it — which is why D2 forbids gating on it.

## The existing mid-run flow (kept)

The build kit (`api/oss/src/core/workflows/build_kit.py`) embeds two static client tools in
every playground agent: `__ag__request_connection` and `__ag__request_input`. The builder
skill instructs: "If a needed connection is not ready, call `request_connection` for that
integration and stop." The FE renders it through `ConnectToolWidget` (inline marker) plus
`InteractionDock` (the actions). The runner parks only **one** interaction per turn; a
second `request_connection` in the same step is force-settled with a `DEFERRED_NOT_EXECUTED`
sentinel and re-asked next turn.

That one-at-a-time deferral is a concrete argument for the pre-create step: an agent needing
three accounts costs the user three separate turns today.

## Test conventions

- Package unit tests live in `tests/unit/` (not `src/`), vitest, run with
  `pnpm --filter @agenta/entities test:unit`. Example to mirror:
  `web/packages/agenta-entities/tests/unit/agentTemplates.test.ts`.
- App-layer tests are colocated (`agent-home/assets/agentName.test.ts`).
