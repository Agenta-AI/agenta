# Context

## Why this exists

People creating an agent need to connect the accounts the agent will use before setup
finishes. Today both onboarding paths commit the agent immediately and leave connections
to the builder agent, which asks for them mid-run via the `request_connection` client
tool — often several turns in, after the user has stopped thinking about setup.

## Correction to the issue's premise

The issue says "template onboarding handles only integrations declared by the selected
template" and points at `TemplateSetupDrawer`, which renders required-integration rows.

That drawer is **not on the default path.** It opens only when
`NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER=false`. With the flag at its default (`true`),
`useTemplateSelect` / `useCreateAgentFromTemplate` create the agent straight from the card
click, seeded with the template's builder message. So on the shipped path, template
onboarding has **no integration step at all**.

Consequence for scope: this is not "extend a drawer". It is introducing a gate on paths
that currently have none, and deciding what happens to the drawer.

## Goals

1. Identify the integrations an agent will need, from the onboarding answers and the
   selected template.
2. Let the user connect each one before the agent is created.
3. Let the user skip optional ones without blocking creation.
4. Collect enough in onboarding to identify the accounts *and* the actions the agent needs.
5. Carry the selections into the created agent's configuration.
6. Cover both flows with frontend tests.

## Non-goals

- Removing or changing `request_connection`. It stays as the mid-run safety net for
  anything skipped or missed.
- Backend inference of required integrations from free text (that is D5/S5, a later swap
  behind the same UI contract).
- Asking for per-connection values (which channel, which repo). Those stay with
  `request_input` mid-run, where the options are real values instead of a typo-prone field.

## Locked decisions

Approved 2026-08-24 by Arda, off design iteration 1.

| # | Decision | Resolution |
|---|---|---|
| D1 | Which iteration? | **B, inline reveal**, with C's copy voice. A is the flag-off template arm only. |
| D2 | Do text-detected accounts block Create? | **No.** Only template-declared ones gate. A guess may offer, never obstruct. |
| D3 | Does the template card click gate when the builder flag is on? | **Yes** — the card click routes through the same step. |
| D4 | New flag or fold in? | **New `NEXT_PUBLIC_AGENT_CONNECT_STEP`, default on**, so it is A/B-able against instant-create. |
| D5 | How do choices reach the created agent? | **M2 now** (structured seed preamble), **M1 later** (config write) once the item shape is confirmed with Mahmoud. |
| D6 | App layer or package? | **Package.** The card goes in `@agenta/entity-ui`; the pure detector in `@agenta/entities/workflow`. Two hosts already exist (`web/oss`, `web/mobile`). |
| D7 | Does `TemplateSetupDrawer` survive? | **Kept this round** as the flag-off comparison arm; deleted when the flags retire. |

## Owners

- Frontend: Arda (issue assignee).
- Builder-side config shape (D5/M1) and any pre-commit planning turn (S5): Mahmoud.
