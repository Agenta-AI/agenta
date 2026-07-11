# Agent-chat interaction kinds — decision record

Status: design APPROVED + eng-reviewed 2026-07-04. Source of truth for the full design:
`~/.gstack/projects/Agenta-AI-agenta/ardaerzin-fe-big-agents-wip-design-20260704-025019.md`
(Arda's machine; ask for a copy if you don't have it). This file pins the durable decisions
so they travel with the code.

## Locked decisions (summary)

- **Declarative UI with a closed component set — never open-ended generative UI.** Three
  interaction kinds on the client-tool registry seam (`render.kind` dispatch): `elicitation`
  (flat MCP-elicitation-dialect forms), `display` (read-only schema→cards/tables),
  `config-card` (closed op catalog, applied to the playground draft). Per-kind contracts;
  **no universal schema DSL** (a paper test proved one cannot survive both flat forms and
  nested config diffs).
- **`render.kind` is a REQUIRED wire field for interaction kinds.** The resume predicate
  (`agentApprovalResume.ts`) and the registry both key on it; without it a new client tool
  settles but never auto-resumes. The hint rides a sibling `data-render` part (AI SDK tool
  chunks are strict); the FE merges it via a message-scoped render map.
- **UI-ownership taxonomy:** payload-defined (generic renderer, non-sensitive only) /
  **platform-defined flows** (wire carries intent only; a vetted widget owns the whole flow) /
  domain ops. **Secrets never touch the chat wire in either direction** — platform widgets
  post to the vault API directly; the settling tool result carries only a reference.
- **Composition ruling:** platform-flows compose at the component level, never the wire
  level. One intent → one settle; composite internals are ephemeral (not replayed); one
  pending wire interaction per composite. A drawer with no paused run is product UI outside
  this contract.
- **Config-card propose-vs-narrate threshold:** narrate reversible/low-stakes (set_name,
  instructions); propose standing side-effects (add_tool, create_subscription).
- Four replayable part states (pending → submitted | declined | cancelled) + degradation
  surface with a retry cap. One card chrome; state carried by status line (`{state} · {next}`
  pill vocabulary, always neutral).

## Elicitation dialect extensions (2026-07-10, PR #5177)

The M1 dialect ("top-level primitives/enums only") gained three extensions once template
questionnaires (Mahmoud's agent-templates work) hit its limits. The governing principle for
all three: **adopt the standard JSON Schema idiom over bespoke hints** — the payload author
is an LLM, and it already knows these shapes from training data.

- **`default`** (issue #5190): a proposed value prefilling the field, so the user can accept
  the whole form in one click. Primitives on scalar fields; array-of-strings on multi-select.
  Date/date-time fields ignore it (a wire default is an ISO string; antd DatePicker requires
  dayjs — render-side guard, not a contract rule).
- **Multi-select**: exactly one array shape is admitted — `{type: "array", items: {type:
  "string", enum?/oneOf?}}`. String leaves only, nothing deeper; the answer is an array of
  strings. Renders as a chip picker (checkbox choice cards when options carry descriptions).
- **Context-ful options**: `oneOf: [{const, title, description}]` on single fields and array
  items. Any option description upgrades the control from a Select to selectable choice
  cards; titles alone upgrade Select labels. Parse canonicalizes consts into `enum`, so
  downstream consumers never branch on the authored shape.

Rendering ruling that shipped with these: **enum options are SUGGESTIONS, not a hard
constraint** — the consumer of the answer is the agent, which handles off-menu values fine.
Every enum control therefore carries an explicit "Other…" escape hatch (free-text). This is
elicitation-only (`openEnums`/`formats` opt-in flags on the shared form builder); gateway
tool execution forms keep strict enums and `Form.List` arrays, because their schemas are
real API parameters. The `__ag_enum_other__` UI sentinel must never reach the settled
`content` — pinned by unit tests on both the control logic and the E2E resume body.

## Model-composed UI: deliberately OUT OF SCOPE, with a re-evaluation trigger

Evaluated and rejected for now (2026-07-04): letting the model freely compose dashboards /
arbitrary layouts inside chat (OpenUI/openui-lang by Thesys, Google A2UI / Open-JSON-UI,
Vercel json-render class of systems). OpenUI digest verdict: **watch, don't align** —
model-authored UI DSL, in-process React evaluation, no sandbox, no secrets story, no part
lifecycle. Its security posture is the strongest validation of the platform-owned-widget +
secrets-off-wire rules above.

**RE-EVALUATION TRIGGER — do not skip:** if a real need for model-composed dashboards inside
chat appears (agent freely laying out charts/tables beyond the closed kinds), that is NOT an
incremental extension of this system — it deliberately violates the closed-set premise. Run a
fresh design/office-hours evaluation comparing **OpenUI vs A2UI vs Vercel json-render** at
that time (specs move fast; re-check maturity, sandboxing, and adoption), and revisit the
security boundary explicitly. Until then, requests shaped like "let the agent draw arbitrary
UI" are answered by adding a kind or a platform widget, not a UI language.

## Adopted from the OpenUI digest (cheap steals)

- `humanFriendlyMessage` on settle/action envelopes — a display label riding each user
  action so replayed transcripts are self-describing without re-resolving the widget.
- Default-value-then-hydrate convention for data-fetching display widgets (render instantly
  against a declared default; real data swaps in).
