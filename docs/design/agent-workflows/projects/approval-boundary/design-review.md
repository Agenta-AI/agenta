# Design review: does the approval boundary make sense?

Prerequisite: [how-approvals-work.md](how-approvals-work.md). This document judges the
design, names its structural problems, and states the principles a fix should follow. The
concrete plan lives in [plan.md](plan.md). An independent second opinion (OpenAI Codex,
xhigh reasoning) reviewed both this analysis and the fix options; where it sharpened or
overruled a lean, the text says so.

## The short version

The intended design is sound. The capability-config proposal
(`../capability-config/proposal.md`) got the model right: per-tool permission
(`allow | ask | deny`) as the policy, a global default for unset tools, and enforcement at
whatever choke point each tool passes. It even warned, in writing, against the exact
mistake that later happened: "collapsing the two — treating `permission_policy` as if it
were a fourth permission — is the mistake to avoid."

The implementation diverged from that model in one decisive way: **the runner decides
whether to pause from transport metadata (a session id) instead of from the authored
policy.** Everything else on this list is either a contributor to that divergence or a
smaller instance of the same pattern.

## The structural problems

### 1. Intent is inferred, not declared

Whether a tool call needs a human is a fact about the tool and its config. The runner
instead infers it from `sessionId` presence (`sandbox_agent.ts:627`). Transport metadata is
owned by other layers for other reasons, so it changes for other reasons; when the SDK
started minting session ids for every request, the inference silently inverted and no test
noticed. Policy inputs must be explicit fields with one owner, never proxies.

### 2. The policy vocabulary cannot express the design

The global policy is `auto | deny`. The per-tool vocabulary is `allow | ask | deny`. The
global one has no `ask`, so "pause for a human" is not expressible as policy at all. That
missing word is why the code reached for a proxy: the runner wanted to say "someone might
want to answer this" and had no policy value to say it with, so it looked at the session id.
A design that cannot express its central concept in its own vocabulary will express it as a
hack.

### 3. Three enforcers, no single computer

The per-tool disposition is computed independently in three places:

- Python, when rendering Claude's settings file (`claude_settings.py:151-189`);
- TypeScript, in the relay for runner-executed tools (`relay.ts:143-152`);
- and never, in the one place that decides about parking (the ACP responder).

Each site consults a different subset of the config. The responder sees none of it, the
relay collapses `ask` onto the policy (its own `TODO(S5)` admits this), and the settings
renderer erases the ask/unset distinction before the gate is ever raised. Three enforcement
points are fine (tools genuinely pass different choke points), but three independent
*computations* of the same policy, in two languages, guarantee disagreement. One layer
should compute; every enforcement point should look up.

### 4. The approval event fires before the decision

`attachPermissionResponder` emits `interaction_request(user_approval)` before it consults
the responder (`permissions.ts:93-107`). So the event does not mean "a human must act"; it
means "a gate was raised", and the consumer must guess which. Under any fix where `auto`
answers gates in place, an auto-approved run would still emit an approval request that no
one should act on. Events must mean what their consumers will do with them: emit the
approval request only when the run actually pauses for an answer. The "human sees what ran"
need is already served by the `tool_call`/`tool_result` events.

### 5. Batch erases the terminal state

`_agent_batch` returns only the final assistant text; `stop_reason` is read nowhere
(`app.py:303-321`). A run that paused for an approval is indistinguishable from a run that
finished. Whatever the permission semantics become, a caller must be able to see "this run
paused, here is the pending interaction". This is visibility, not permission logic, but it
is what turned a behavior bug into a silent one.

### 6. Two planes, stitched halfway

The messages plane (decision rides in the conversation) is the real product path. The
interactions plane (durable rows plus respond endpoint) is deliberately future work, but its
current half-wiring creates traps: the runner writes rows only for committed revisions, the
respond endpoint re-invokes instead of resuming, and the product UI never reads the plane.
None of this blocks the fix, but the fix must not deepen the split: parking should keep
producing interaction rows (they are the seed of the durable flow), and the paused state
that batch surfaces should carry the interaction identity so the future respond flow has
something to grab.

### 7. The playground UX leans on the bug's behavior

Today the playground gets its Approve/Deny prompt because *everything* parks. Under correct
`auto` semantics, the prompt appears only for tools that resolve to `ask`. That is the
intended product behavior (the owner confirmed: auto means auto everywhere), but it is worth
stating as a design consequence: the UI's gate experience becomes a function of authored
config, not of the surface you run from. The tool editor's defaults (read-only tools default
to `allow`, mutating tools to `ask` via catalog hints) become the main source of prompts.

## What makes this area genuinely tricky

These are constraints any design must respect, not flaws:

- **Claude gates first.** Claude Code consults its own settings before asking anyone.
  The only way to pre-approve a tool on Claude is a rendered allow rule; the only way to be
  asked is to leave the gate raised. The settings file is therefore part of the permission
  system whether we like it or not (F-046 proved this).
- **Park must not answer.** Replying "reject" to pause breaks the UI, because Claude turns
  the reject into a failed tool call that overwrites the approval prompt (F-024). Pausing
  means: no reply, tear down, resume by cold replay. This mechanism is correct and stays.
- **Resume is a cold replay.** Every turn is a fresh session; approvals must re-match a
  re-raised gate by tool name plus canonical args. The keying is deliberate security
  hardening (bare names would over-authorize) and constrains any alternative resume design.
- **Harnesses are asymmetric.** Pi never raises gates, so per-tool `ask` on Pi is
  enforceable only at the relay, which today cannot park mid-prompt. Claude builtins have no
  tool spec, so their dispositions exist only as authored settings rules.

## Principles for the fix

1. **Declare intent; never infer it from transport.** Park only when the resolved
   disposition says `ask`. Delete `hasHumanSurface`. Session ids stay what they are:
   correlation for persistence and tracing.
2. **One computer, many enforcers.** The SDK already owns `effective_permission()` and the
   settings rendering; make it compute one resolved permission plan (default disposition
   plus per-tool dispositions, including structured rules for Claude builtins) and ship it
   on the run request. The responder and the relay become lookups into the same plan.
   (Codex pushed hard on this point: a fix that only patches the responder "fixes `auto`
   while silently breaking explicit builtin `ask`", because authored ask-rules for Claude
   builtins are visible only inside the settings file.)
3. **One vocabulary.** `allow | ask | deny` everywhere. The global default becomes
   `default_permission` in the same vocabulary (`auto` maps to `allow`; a global `ask` is
   now expressible and legitimate: approval-by-default). Retire the
   `runner.interactions.headless` authoring path in favor of a name inside the permission
   family.
4. **Events mean actions.** Emit `interaction_request(user_approval)` only when the run
   pauses. An auto-approved gate emits nothing extra; the tool events already show what ran.
5. **Terminal state is always visible.** Batch surfaces `stop_reason` and, when paused, the
   pending interaction identity.
6. **A stored approval never overrides a current deny.** The decision order is: resolve the
   disposition first; consult stored decisions only when the disposition is `ask`. (Codex
   flagged this ordering; the current code checks stored decisions first, so a stale
   approval could outrank a config that has since been changed to deny.)

## On the alternative shapes we rejected

- **The one-line fix** (consult the policy before parking) restores `auto` but silently
  auto-approves every `ask`/unset tool too, killing the playground prompt. Rejected.
- **A disposition-aware responder without the shared plan** fixes resolved tools but leaves
  Claude-builtin ask-rules invisible to the responder, so an author's explicit `ask` on
  `Bash` would auto-approve under a policy of `allow`. Rejected as a final state; acceptable
  only as an explicitly temporary step.
- **Settings-only gating** (render everything into Claude's settings, drop ACP parking)
  cannot express `ask` without re-triggering the F-024 clobber, does nothing for Pi or
  relay/client tools, and was rejected by the second opinion as well.
