# Alternatives — every strategy considered, and the win comparison

The single record of what was weighed and why. Kept so nothing here is re-proposed.
Verified against the runner on `main`, 2026-07-26. Baseline is 18,353 tokens
([baseline.md](baseline.md)).

## All strategies

| # | Strategy | What it does | Win | Status | Why not |
| --- | --- | --- | ---: | --- | --- |
| 1 | **Schema diet** | Shrink the two fat schemas to shallow + pointer to prose that already ships | 18,353 → ~3,000 | **adopted** | — |
| 2 | **Lazy schema** | Real names + stub schemas; `load_op` returns the full schema on request | → ~500 | **adopted** | — |
| 3 | **Lazy activation** | Tool entry absent until activated | → ~400 | **out of scope** | ~100 tokens over #2; its case is wander, which is unmeasured. Only lever needing per-harness transport work — free on Pi, hard on Claude/Codex. Detail below |
| 4 | **Card/menu invoker** | One `agenta_op(op, args)` proxies all 13 ops | → ~400 | **rejected** | Breaks the permission ladder in 4 fail-closed sites; a missed site fails **open**. Full analysis below |
| 5 | **Op-set curation** | Drop the 5-op event pack from the default overlay | ~1,052 (5%) | **rejected** | Cannot be decided at run start. A user who pivots to "schedule this daily" mid-conversation finds the capability gone |
| 6 | **Turn-boundary activation** | Activate only between turns, so no mid-turn push is needed | — | **rejected** | Either stops the agent mid-task waiting for the user, or costs a full transcript replay per activation |
| 7 | **SSE + session ids** | Give the local HTTP MCP server a push channel | — | **rejected** | Large rewrite of a deliberately minimal server, to enable #3's ~100 tokens |
| 8 | **Mode-gating** | No build kit in Chat mode | — | **not a substitute** | Removes capability rather than deferring it. Can layer on top |

**#1 and #2 are the delivery.** Both keep real tool names, touch no permission code, and land on all
three harnesses through one projection site. Detail: [design.md](design.md).

## #3 — lazy activation, out of scope

Ops would start **inactive** — not in the model's tool list at all — with a loader adding one on
demand. This is the only lever that reduces tool *count*, which is what the internal-tools review
tied to wander. **Not being built until explicitly asked for.**

### Why it is out of scope

**It buys ~100 tokens over #2.** Both leave names and one-liners in the prompt and both fetch
schemas on demand; the difference is 13 stub entries. Its case is wander, not tokens — and wander is
currently asserted, not measured. A lever whose entire justification is unmeasured should not gate
the levers whose justification is measured.

**It is the only lever needing per-harness transport work**, and two of three harnesses make it
hard:

| harness | delivery | activation | state |
| --- | --- | --- | --- |
| Pi | native, bundled extension | `pi.setActiveTools()` | **works today** |
| Claude — Daytona | in-sandbox stdio shim | `notifications/tools/list_changed` | possible, unverified |
| Claude — local | HTTP loopback | none | blocked |
| Codex | MCP, same as Claude | same as Claude | after PR #5509 |

### The hard part, precisely

**Pi is free.** `getAllTools()` / `getActiveTools()` / `setActiveTools()` exist and are already used
(`extensions/agenta.ts:215`). Mid-turn, in-process, no transport involved.

**Claude and Codex are MCP-forwarding** (`capabilities.ts:99`), so adding a tool mid-turn requires
the server to *push* `notifications/tools/list_changed`. Three problems stack:

1. **Local HTTP cannot push at all.** The loopback server is *"stateless JSON mode… no SSE… 405 for
   `GET`"* (`tool-mcp-http.ts:22-27`). There is no server→client channel. Fixing it means either
   running the stdio shim on the runner host — a security-posture change, since `tool-mcp-stdio.ts`
   is written to run inside the sandbox and its docstring flags runner-host stdio as a deliberately
   closed hole (#4831) — or building SSE + session ids (#7), which undoes the "simplest conformant
   server" design.
2. **The shim's tool list is a startup snapshot.** `tool-mcp-stdio.ts` reads specs once from
   `AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE`. It would need a runner signal over the relay dir to
   re-read and notify, plus `capabilities: {tools: {listChanged: true}}` at `initialize` — today the
   shim sends `{tools: {}}` (`tool-mcp-stdio.ts:183`), as does the HTTP server
   (`tool-mcp-http.ts:124`).
3. **The clients may ignore the notification mid-turn.** `@agentclientprotocol/claude-agent-acp` and
   `codex-acp` are third-party and version-pinned. Whether either re-lists **mid-turn** is
   unverified. If they only re-list on reconnect, activation lands at a turn boundary — the agent
   must stop and wait for the user mid-task, or pay a full transcript replay per activation. Both
   are unacceptable in a builder flow (that is #6).

Problem 3 is unfixable by us if it fails. Three units of transport work, one outside our control,
for ~100 tokens and an unmeasured reliability claim.

**If it is ever asked for:** measure wander first. Then Pi only (free, no transport work), and
Claude/Codex only after a spike confirms mid-turn re-listing.

## #4 — card/menu invoker, in full

**Status: rejected 2026-07-27.** This was the original proposal, so it gets the full write-up.
**None of it applies to #1 or #2**, because neither changes a tool's name.

| | Card/menu (#4) | Lazy schema (#2) |
| --- | --- | --- |
| Model calls | proxy: `agenta_op(op, args)` | real op: `commit_revision(args)` |
| Gate sees | `agenta_op` for all 13 ops | the real op |
| `readOnly` / `allow_reads` | one value for 13 ops — breaks | the op's own — works |
| Policy rules (`remove_schedule: deny`) | stop matching, silently | keep matching |
| Arg validation | lost (opaque `args`) | kept (runner-side, private spec) |
| Round trips per new op | 2 | 2 |
| Work | 4-site permission surgery + wire marker + dispatch | 1 projection function |
| Fails toward | **too permissive, silently** | schema not loaded yet, loudly |

Card/menu's one advantage was that it is transport-agnostic — a plain tool, identical on every
harness. That is why it was proposed first. It stopped being an advantage once the levers were
split: **#2 is transport-agnostic too**, at one function, with no permission change at all.

### The root cause

A tool's name does two jobs: it **resolves the private spec** the gate reads its fields from, and it
is **itself matched** by policy rules. The decision ladder (`effectivePermission`,
`permission-plan.ts:125`) uses both:

```text
gate.specPermission   (from resolved spec)  -> short-circuits the rest when set
matchingRulePermission(gate, rules)         -> matches on gate.toolName itself
defaultPermission(mode, gate)               -> allow_reads: gate.readOnlyHint ? allow : ask
```

The card/menu invoker routes all 13 ops through one name, `agenta_op`. Every input above then reads
off one spec.

The regression is not the deferral — it is **building the gate from the invoker's spec instead of
re-resolving the target**. It is fixable, but the fix has to land in four fail-closed sites, and a
missed site fails **open**.

### What breaks

**1. `readOnlyHint` — the `allow_reads` default.** `defaultPermission` (`permission-plan.ts:248`):

```ts
if (mode === "allow_reads") return gate.readOnlyHint === true ? "allow" : "ask";
```

`readOnlyHint` comes from `spec.readOnly`, set per op. One invoker spec covers thirteen:

- `readOnly: true` → every write executes silently. `commit_revision`, `remove_schedule`,
  `remove_subscription` lose their prompt.
- `readOnly: false` → every read prompts. Habituated click-through is worse than not prompting.

No static value is correct.

**2. `specPermission`.** Short-circuits the whole ladder (`:129`). One value for thirteen ops, and
it wins over any rule.

**3. Policy rules stop matching.** `ruleMatches` (`:214`) compares `gate.toolName` exactly. A rule
written as `commit_revision: ask` or `remove_schedule: deny` stops matching once calls arrive as
`agenta_op`. It does not error — it falls through to the default, so `deny` becomes whatever
`allow_reads` decides. Rules authored before the change quietly stop being enforced.

**4. Grant / stored-decision keys — safe.** Both `ApprovedExecutionGrants` (`responder.ts:85`) and
`ConversationDecisions.take` (`:255`) key on `approvedCallKey(toolName, args)` — name **plus** a
canonical args hash. The invoker's args carry the op name, so distinct ops produce distinct keys.
No cross-op approval leak. The only requirement is that `grant()` and `consume()` key consistently;
a mismatch fails closed (every Pi write refused), which is a bug, not a hole.

### The four sites

Each independently resolves a spec from a name and builds its own `GateDescriptor`.

| # | Site | Path |
| --- | --- | --- |
| 1 | `buildRelayExecutionGuard` | `engines/sandbox_agent/relay-guard.ts:53` |
| 2 | `buildGateDescriptor` (Claude/ACP) | `engines/sandbox_agent/acp-interactions.ts:516` |
| 3 | `buildPiGateDescriptor` (Pi) | `engines/sandbox_agent/acp-interactions.ts:456` |
| 4 | `piDialogAllows` call (in-sandbox) | `extensions/agenta.ts:318` |

PR #5509 adds an `ExecutableToolGate` seam, so this becomes five once Codex merges.

Site 4 has an extra problem: the in-sandbox extension only sees the **advertised** set, so under
disclosure it no longer holds the target's `readOnly` and cannot decide `gateViaDialog` locally.

### What was *not* a risk

Routing the decision through a sandbox-supplied `args.op` is **not** new trust exposure. The tool
name is already sandbox-supplied (`acp-interactions.ts:307`: *"the envelope is sandbox-origin and
untrusted"*) and is safe because it is validated against a fixed spec map, failing closed otherwise
(`:473`). Reading `args.op` and validating it the same way is the same pattern at the same trust
level. The cost is surface area — four hand-written lookups instead of one.

### Other costs

- **Pre-call validation lost.** Pi registers each tool with its real schema
  (`extensions/agenta.ts:305`); `assertRequiredArguments` checks required fields (`:318`,
  `relay.ts:369`). A generic invoker makes `args` opaque, degrading both to the invoker's loose
  schema.
- **Two execution shapes.** Endpoint-mode ops carry a direct `call`; handler-mode `test_run` carries
  a `callRef` and runs through `callAgentaTool`. An invoker forwarding only `spec.call` cannot
  execute `test_run` at all.
- **Eligibility has no clean rule.** Platform ops do not share one shape, and neither field
  identifies them:

  | | direct `call` | `callRef` |
  | --- | --- | --- |
  | platform op | 12 endpoint ops | `test_run` |
  | not a platform op | author's `reference` tool | gateway tool |

  A direct-`call` heuristic misses `test_run` — 7,777 tokens, 42% of the bill — and over-collapses
  author tools. A `source:"platform"` wire marker would have been required.

### Verdict

The invoker's cost is security-critical work that fails toward "too permissive," silently. The
chosen levers cost one Python file and one projection function, touch no permission code, and fail
toward "the schema isn't loaded yet," loudly. For a system whose job is gating an agent's writes to
a user's own agents, that asymmetry decides it.
