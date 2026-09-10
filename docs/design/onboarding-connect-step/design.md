# Design

Iteration B — the setup card reveals inline on the surface the user is already on, between
"describe it" and "create it". Mockups:
<https://claude.ai/code/artifact/df1e9483-6da8-43b9-82ca-0c8fbd0da82d>

## 1. The flow

```
describe / pick template
        │
        ▼
  ┌──────────────┐   detect → connect → confirm
  │  setup card  │   (skippable unless template-declared)
  └──────────────┘
        │
        ▼
  useCreateAgent  ← seed preamble carries the choices
        │
        ▼
  builder runs, connections already in the vault
        │
        ▼
  request_connection  ← unchanged safety net for anything skipped
```

## 2. Anatomy

`AgentSetupCard`, in `@agenta/entity-ui/onboarding/`. One component, two hosts.

- **Header** — title, and a right-aligned status pill: `2 found` / `Required` /
  `1 skipped` / `All set`.
- **Lead line** — why these rows are here, and what skipping costs. Voice borrowed from
  iteration C (the agent explaining, not the product instructing).
- **Account rows** — `AccountRow`, extracted from `TemplateSetupDrawer/IntegrationRow.tsx`:
  logo, name, why-line, and a right slot that is `Connect` + `Skip`, `✓ Connected`, or
  `Skipped — Undo`. Required rows carry the warning treatment already in `IntegrationRow`.
- **Suggestion chips** — up to three more likely accounts plus `＋ Search all`, which opens
  the existing catalog search.
- **Footer** — the permission control on the left, the primary action on the right, and a
  muted note stating the consequence of the current state.

### States (all four are in the mockup's state matrix)

| State | Trigger | Create |
|---|---|---|
| Required outstanding | template-declared account not connected | disabled, note names what's left |
| Nothing detected | free text, no match | enabled, card collapses to chips |
| Guess skipped | user skipped a detected row | enabled, row dims with Undo |
| Already connected | workspace already has the connections | enabled, rows collapse to chips |

## 3. The gating rule (D2)

**Template-declared accounts gate Create. Text-detected accounts never do.**

```ts
canCreate = requiredAccounts.every(isConnected)
```

`requiredAccounts` is exactly `template.requiredIntegrations`. Everything produced by
detection is `suggested`, and a suggested account has three terminal states — connected,
skipped, ignored — none of which block. This is the rule that makes a fallible heuristic
safe to ship: the worst a wrong guess does is offer.

## 4. Detection (S1 + S2 + S4 now; S3 optional; S5 later)

Pure module, `web/packages/agenta-entities/src/workflow/detectAccounts.ts`. No React, no
network, so it is unit-testable in isolation and swappable wholesale for S5.

```ts
export interface DetectedAccount {
    slug: string                    // PROVIDERS key
    label: string
    logo?: string
    why: string                     // "Read issues · comment · label"
    origin: "template" | "text"     // origin decides gating, not confidence
    required: boolean               // true only for template-declared
}

export function detectAccounts(input: {
    description?: string
    template?: AgentStarterTemplate
}): DetectedAccount[]
```

- **S1 template** — `requiredIntegrations` map straight through with `required: true` and
  `why` from the integration's `scope`. These come first and are never deduped away.
- **S2 text** — case-insensitive match of the description against each `PROVIDERS` label
  and slug, plus a small alias table. Word-boundary matched, so `"hub"` does not hit GitHub
  and `"linear algebra"` does not hit Linear.
- **S4 user** — the chips and `＋ Search all`. Always present, including when detection
  returns nothing. This is what makes S2's fallibility acceptable.
- **S3 catalog search** — only if token extraction proves clean in practice; a debounced
  `fetchToolIntegrations({search})` for capitalised tokens S2 missed.
- **S5 backend** — a pre-commit planning turn returns the list. Drops in behind the same
  `DetectedAccount[]` contract with no UI change. Not this round.

### Alias table (initial)

Deliberately conservative. Every entry must be a phrase whose *only* plausible reading is
that integration; anything ambiguous is left to S4.

| Alias | Slug |
|---|---|
| pull request, PR, repo, repository | github |
| inbox, email, e-mail, mail | gmail |
| calendar, meeting, schedule | googlecalendar |
| issue tracker, ticket | linear, jira (both offered) |
| channel, DM | slack |
| wiki, docs page | notion, confluence (both offered) |
| on-call, incident, page | pagerduty |

Ordering: required first, then text matches in the order they appear in the description
(the user's own emphasis is a better signal than an arbitrary catalog order).

## 5. The questions (issue item 4)

Two, and both are answered by touching the card rather than filling a form.

1. **Which accounts?** Not phrased as a question — the rows *are* the answer. Pre-filled
   from S1/S2, corrected with Connect / Skip / Add. A user who agrees answers in zero clicks.
2. **How much may it do?** A segmented control: `Read only · Ask before writing · On its own`.
   Default `Ask before writing`. It scopes which tools get attached, sets the approval
   posture, and gives the builder a real constraint instead of guessing from prose.

Deliberately **not** asked: which channel / repo / board. The agent asks that mid-run via
`request_input`, where it can list the real options.

## 6. Carry-through (D5, revised)

**M1 is not viable for this step. Checked, not assumed.** A connected-app tool is per-ACTION:
`{type: "gateway", provider, integration, action, connection}`, and `parseGatewayTool`
(`entity-ui/DrillInView/SchemaControls/toolUtils.ts`) returns `null` without `action`. There is
no toolkit-level tool object. The setup step knows the *integration* — it has no basis to pick
`GITHUB_CREATE_ISSUE` over `GITHUB_LIST_ISSUES`, and guessing actions into the config is worse
than writing none: the builder resolves them properly through `discover_tools`.

The same applies to the permission answer — `permission` is a field *on a tool*, so there is
nothing to write it onto until the tools exist.

**So M2 is the carry-through, permanently.** `useCreateAgent` takes an optional `setup`
argument and `appendSetupPreamble` adds the step's answers to the seed message.

**Written in the user's voice, first person.** The seed is auto-sent as the first turn and
renders in the transcript as the user's own message — there is no hidden-context channel
(`AgentFirstRunSeed` carries text only, and adding one means plumbing through the chat send and
the runner's request shape). A machine block appended under their sentence reads as something
they never typed, so the preamble is written as something they would:

```
Triage new GitHub issues and post a daily digest to Slack.

I've connected GitHub. I've skipped Slack for now — ask me when you need it. Ask me before you
write or send anything.
```

Nothing is added when the user connected nothing and kept the default posture, so the common
case leaves the seed exactly as typed.

**If the visible line is still unwanted**, the remaining option is a hidden context channel on
the seed — a cross-package change through `@agenta/chat`'s send path and `agentRequest`. Not
done: it is bigger than this issue and needs the runner contract's agreement.

## 7. Flag (D4)

`NEXT_PUBLIC_AGENT_CONNECT_STEP`, default on, in `agent-home/assets/constants.ts` following
the existing pattern:

```ts
export const CONNECT_STEP_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_CONNECT_STEP") || "").toLowerCase() !== "false"
```

Off restores instant-create on every path, so the step is A/B-able against the current
behaviour like every onboarding change before it.

## 8. Copy

Written from the user's side; the consequence of every state is stated, never implied.

| Slot | Text |
|---|---|
| Header, detected | Connect what it needs |
| Header, nothing detected | Any accounts to connect? |
| Header, all set | Ready to build |
| Lead, detected | From your description. Connect now so the agent can run the moment it's built — or skip and it'll ask when it gets there. |
| Lead, nothing detected | We didn't spot a specific service in your description. Add one now, or let the agent ask when it needs one. |
| Footer note, required outstanding | Connect {name} to create. |
| Footer note, skipped | Skipped accounts are asked for later. |
| Footer note, all set | Nothing to do here. |
| Skipped row | Skipped — the agent can ask later |
| Primary | Create agent |

## 9. Theming

No new palette entries. The card is built from existing semantic tokens: warning
border/background for an outstanding required row (matching `IntegrationRow` today),
success for connected, `colorBorderSecondary` for neutral. Both themes verified before the
work is called done; per `reference_shared_component_tokens_mobile`, the package component
uses no `--ant-color-*` literals and no `border-0 border-b` pattern, so it survives on `/m`.
