# Code organization review

Scope: the permission/approval code across the runner, the SDK, the service, and the config
schema. This review asks whether the code is well organized, well named, well documented,
and safe for a new engineer to modify. Correctness findings live in
[code-review.md](code-review.md).

## Verdict

The code is maintainable by the people who wrote it and reviewable by anyone, but it is not
yet safely modifiable by a newcomer. The comment discipline is exceptional: nearly every
dangerous invariant is documented at the exact point of use, with issue IDs, and pinned by a
named regression test. What is missing is a map. The single concept "a tool needs
permission" is decided in four places, spoken in five vocabularies, and its main knob has
three names across layers. Answering "where do I change permission behavior?" requires
holding the whole system in your head. Worst, the one comment that anchors the central
branch (`hasHumanSurface`) is now false: the code still runs, but the documented reason it
works has drifted out from under it. That drift is exactly how the bug in
[the-bug.md](the-bug.md) survived.

## What is good (keep it)

Credit first, because several habits here are worth spreading:

- **Invariants documented at point of use, with history.** The park semantics block
  (`services/runner/src/responder.ts:26-41`) says "Do NOT 'simplify' park back to `deny`"
  and explains the F-024 mechanism that makes it dangerous. The park-teardown rationale
  (`sandbox_agent.ts:628-634`), the onPark contract (`permissions.ts:8-16`), and the
  four-source merge inventory in `claude_settings.py:10-31` are equally strong.
- **Types encode the invariant.** `ResponderOutcome = PermissionDecision | "park"` plus
  `decisionToReply(decision: PermissionDecision, ...)` means the compiler enforces "park
  never becomes an ACP reply". The F-024 rule lives in the type system, not just a comment.
- **Deliberate security guards.** Approvals key on tool name plus canonical args, never bare
  name (approving call A does not approve call B). Allow replies "once", never "always".
  Both guarded by tests with names that say why.
- **`effective_permission()`** (`sdks/python/agenta/sdk/agents/tools/models.py:273-292`) is
  a genuine single source of truth for the per-tool ladder over the legacy fields.
- **`claude_settings.py` is the model file.** Its docstring lists all four rule sources it
  merges, each helper names its layer, and merge order is stated at the merge site. None of
  the four looks like the only one. The rest of the subsystem should meet this bar.
- **The golden wire contract** (shared fixtures + compile-time key guard) is the right
  cross-language pin.

## Findings

### 1. Ownership: four enforcement sites, no map

"What happens when a tool needs permission" is implemented in four places:

1. `HITLResponder`/`PolicyResponder` for harness-gated tools
   (`services/runner/src/responder.ts:194`).
2. `resolvePermission` for runner-executed relay tools
   (`services/runner/src/tools/relay.ts:143`).
3. The rendered Claude `settings.json` rules, which pre-empt the runner entirely
   (`sdks/python/agenta/sdk/agents/adapters/claude_settings.py:201`).
4. The sandbox boundary (the network/filesystem isolation config), which renders further
   deny rules.

Changing the meaning of `ask` touches at least three files in two languages. Each site
labels its own layer, which is good, but no document or module lists all four. Related
duplication: the policy collapse `policy === "deny" ? "deny" : "allow"` is written three
times (`responder.ts:83`, `responder.ts:205`, `relay.ts:151`) and can drift.

Also in this theme:

- `PolicyResponder` is dead in production. `runSandboxAgent` always constructs
  `HITLResponder` (`sandbox_agent.ts:651-656`); `PolicyResponder` survives only in comments
  and tests. Delete it or mark it test-only.
- The client-tool park path is wired twice with hand-built, differently shaped payloads
  (`permissions.ts:64-75` vs `sandbox_agent.ts:719-737`), and neither site mentions the
  other. Only `user_approval` parks record an interaction row; client-tool parks silently
  skip the interactions plane with no comment saying so.
- The HITL subsystem has no home: `responder.ts` (top level), `engines/sandbox_agent/
  permissions.ts`, `sessions/interactions.ts`, and ~150 inline lines of park machinery in
  `sandbox_agent.ts` are one subsystem spread over four locations with no shared directory
  or prefix.

### 2. Naming: names that lie or collide

| Name | Problem | Suggestion |
| --- | --- | --- |
| `runner.interactions.headless` / `permission_policy` / `permissionPolicy` | Three names for one knob. The authored name contains neither "permission" nor "policy"; grepping "permission" misses the authoring surface. | One name, in the permission family: `runner.permissions.default` (see design-review.md). |
| `PermissionPolicy` {auto, deny} vs `Permission` {allow, ask, deny} | Two vocabularies where `auto` and `allow` mean the same thing. | Unify on `allow \| ask \| deny`. |
| `hasHumanSurface` | Truthful intent, untruthful derivation: it actually means "the request has a session id", which no longer implies a human. | Delete as a permission input (see plan). |
| `HITLResponder` | It is also the production headless responder; the name suggests `PolicyResponder` handles headless. It does not. | `ApprovalResponder`, and delete `PolicyResponder`. |
| `permissions.ts` | Wires all ACP interaction kinds, including client tools its own comment says are "not really a permission gate". | `acp-interactions.ts`. |
| `SandboxPermission` | An isolation boundary, not an allow/ask/deny permission; collides with the whole Permission family. The template even has `sandbox.permissions` and `harness.permissions` one line apart with unrelated vocabularies. | `SandboxBoundary` / `SandboxIsolation`. |
| `permission_mode` (legacy per-tool alias) vs Claude `PERMISSION_MODES` | Same words, two unrelated vocabularies, adjacent files. | Rename the Claude constant `CLAUDE_DEFAULT_MODES`. |
| `park` | Internal jargon; nothing says "waiting for an approval". | `pending_approval` internally; keep `stopReason: "paused"` on the wire. |
| `parkedCallResultOf` (`responder.ts:353`) | Matches every `tool_result` block, not only parked-call replies. | `toolResultEnvelope`. |

### 3. Types: stringly seams and one mixed map

- The wire field is stringly typed: `permissionPolicy?: string` (`protocol.ts:428`) with the
  enum only in a comment, while the real `PermissionPolicy` type sits 30 lines away in
  `responder.ts:24`. Type it as the enum.
- `ApprovalDecisions = ReadonlyMap<string, unknown>` mixes permission decisions (the strings
  `"allow"`/`"deny"`) with client-tool outputs (arbitrary values), discriminated at read
  time. A client tool whose stored output is the literal string `"allow"` would be
  misclassified, and the type permits it silently. Use a tagged union.

### 4. Comments: one false anchor, one broken pointer

- **The false load-bearing comment.** `sandbox_agent.ts:621-626` says the headless `/invoke`
  path sets no session id. The SDK normalizer has minted one for every request since the
  session work landed (`normalizer.py:307`, `shared.py:13-22`), and both golden wire
  fixtures carry `sessionId`. A security-relevant branch is anchored to a cross-repo
  assumption that exists only in a comment, with no producer-side test keeping it true. The
  TS test that "pins" the headless case builds a request shape the Python side no longer
  produces.
- **A MUST-sync coupling with a dead pointer.** `claude_settings.py:49-55` couples
  `INTERNAL_TOOL_MCP_SERVER = "agenta-tools"` to the TS runner but cites
  `services/agent/src/...` paths; the runner lives in `services/runner/src/`. The coupling
  is enforced only by this comment, across two languages, and the pointer is broken. Fix the
  paths and pin the constant with a shared-fixture test, like the golden wire contract.

### 5. Tests: strong names, missing table

Test names state behavior and consequence, and the relay's `resolvePermission` is tested as
a generated truth table. Gaps a maintainer would break silently:

- The responder's three-branch decision is tested per branch, not as a matrix. Adding a
  fourth branch (the `ask` surfacing) will bolt on without forcing review of the whole
  table. Convert `responder.test.ts` to a generated table like the relay's.
- Nothing on the Python side asserts what `/invoke` actually puts in `sessionId`, so the
  TS-side "headless" premise drifted unchecked. One runner test even pins the bug as
  correct ("parks when human surface + no stored decision, even under deny basePolicy").
- The `agenta-tools` name coupling has no test on either side.

### 6. File size: `sandbox_agent.ts` carries eight concerns

The engine file is 867 lines and mixes mount signing, connection env, sandbox reaping,
capability probing, MCP setup, the permission/park machinery (~lines 620-770), usage
resolution, and error detection. Sixteen helpers are already extracted into
`engines/sandbox_agent/`; the park machinery is simply the concern that has not been
extracted yet, and it is the most delicate one (it owns `hasHumanSurface`, `onPark`, the
`parked` flag, the race, and the stop reason, all coupled through closures). Extract a park
controller into the module family and give the state machine a direct unit-test seam.

### 7. Config schema, by semantic role

Classifying the permission-ish fields by what they are (policy, config, protocol context):

| Field | Role | Verdict |
| --- | --- | --- |
| per-tool `permission` | Policy, author-owned | Right home: on the tool spec. Correct. |
| `permission_policy` / `runner.interactions.headless` | Policy (the default tier of the same ladder) | Right concept, wrong home and name: authored under `runner.interactions`, which reads as runtime plumbing, with a vocabulary disjoint from the family it defaults. |
| `needs_approval` | Legacy policy input | Correctly demoted under `effective_permission()`; deprecate at the config edge eventually. |
| `sandbox_permission` | Isolation config, not policy | Misnamed into the policy family; placement fine. |
| `harness.permissions` (Claude rules) | Harness-specific policy passthrough | Correctly quarantined; only `claude_settings.py` knows its shape. |
| `sessionId` as consumed by `hasHumanSurface` | Protocol context used as a policy input | The core smell. Policy inputs must be explicit fields, not inferred from routing metadata. |

## The five highest-leverage improvements, ordered

1. Remove the `sessionId` inference behind `hasHumanSurface` (this is also the bug fix; see
   [plan.md](plan.md)) and correct the false comment.
2. Extract the park controller out of `sandbox_agent.ts` into the `engines/sandbox_agent/`
   module family, giving the park state machine a unit-test seam.
3. Unify the knob's name across layers and type the wire field as an enum.
4. Write the four-site permissions map (one short header or doc listing the enforcement
   sites and the "change one, check these" checklist), and fix the dead `services/agent/`
   pointers left by the rename.
5. Deduplicate the client-tool interaction emission and the headless policy collapse; delete
   the production-dead `PolicyResponder`.
