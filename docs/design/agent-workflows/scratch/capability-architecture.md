# Capability configuration: architecture sketch (scratch)

Scratch thinking for how to expose web / execute / read / write (and network) as a single
author-facing configuration that enforces correctly across harnesses (`pi`, `claude`) and
backends (sandbox-agent local, sandbox-agent Daytona, and the not-yet-built local SDK
`LocalBackend`). Pairs with `capability-map.md` (the current-state research). This is a
proposal to argue with, not a decision.

## The core problem in one sentence

One neutral, author-facing capability declaration must fan out to enforcement that lives in
**two different architectural planes** (the harness's tools and the sandbox's isolation), and
must **degrade honestly** when a backend cannot enforce a given plane.

That is the whole difficulty. Everything below is about drawing those two planes cleanly and
deciding who owns what.

## The two enforcement planes

A capability is only real if enforced. There are exactly two places enforcement can happen,
and they are not interchangeable:

1. **The tool plane (harness-owned).** Decide which tools the model is even given. "Web off"
   here means: do not hand Claude `WebFetch`/`WebSearch`; for Pi, drop nothing useful because
   Pi has no web tool, but it can still `curl` from `bash`. "Read-only" here means: give Pi
   `read`/`grep`/`find`/`ls` but not `write`/`edit`/`bash`; give Claude `Read`/`Glob`/`Grep`
   and disallow `Write`/`Edit`/`Bash`. This is **intent and UX**, expressed in the harness's
   own tool vocabulary.

2. **The sandbox plane (backend-owned).** Decide what the running process can physically do,
   regardless of which tools it holds. "Web off" here means: block network egress at the
   sandbox boundary (Daytona `networkBlockAll`). "No writes outside cwd" means: filesystem
   confinement. This is the **security boundary**.

The critical asymmetry: **for network and filesystem, only the sandbox plane is a real
boundary.** Pi can always `curl` from `bash`, so "web off" enforced only in the tool plane is
advisory, not safe. A capability that must be a guarantee (no exfiltration, no writes to the
host) has to be enforced in the sandbox plane. The tool plane is the UX layer on top.

Consequence: the same author toggle ("web: off") means *defense in depth* when both planes
can act (Daytona: hide the web tools AND block egress), and means *best-effort only* when only
the tool plane can act (local: hide the tools, but the process can still reach the network).
The architecture must make that difference explicit, not hidden.

## Who owns what (the boundary map)

Mapping onto the existing ports (`interfaces.py`, `dtos.py`, `adapters/harnesses.py`, the TS
runner). The principle: **each layer already owns a kind of knowledge; attach the matching
slice of capability to the layer that already owns that kind.**

| Layer | Already owns | Capability responsibility |
| --- | --- | --- |
| `AgentConfig` (author-facing) | neutral intent (instructions, model, tools, mcp) | **declare** the neutral capability profile. No enforcement. |
| `SessionConfig` (neutral runtime) | the neutral run bag (builtin_names, permission_policy, secrets) | **carry** the capability profile unchanged to the harness + backend. |
| `Harness` adapter (`PiHarness`/`ClaudeHarness`) | per-harness tool knowledge ("Claude has no Pi builtins") | **translate** capability -> harness tool controls (the tool plane). The only place that knows "web = WebFetch+WebSearch on Claude, curl-in-bash on Pi". |
| `Backend` / `Environment` / `Sandbox` | sandbox lifecycle + policy (`sandbox_per_session`) | **translate** capability -> sandbox provisioning (network/fs isolation; the sandbox plane). Declare what it can enforce. |
| TS runner (`sandbox_agent.ts`) | applying a harness-shaped config to an ACP session + provider | **apply** what it is told: set the session's allowed tools/permission mode; pass network params to the provider. It decides nothing. |

The clean rule: **policy is decided in the SDK (harness adapter + backend), the runner only
applies.** Today the runner accidentally owns policy by omission (it drops `builtin_names`,
never sets Claude tool controls, never sets network). That is the inversion to correct.

## What the author-facing config should look like

Goal: a few legible toggles, not a tool-by-tool checklist. The four capabilities the product
owner named map to coarse axes. A first shape on `AgentConfig`:

```
capabilities:
  filesystem: none | read_only | read_write   # read + write collapsed to one axis
  code_execution: bool                          # shell / run code
  network: off | on | { allow: [cidr|host, ...] }  # web; allowlist is Daytona-only
```

Open questions on the shape (for review):

- **Booleans vs presets.** Presets ("Researcher: read-only, no exec, web on"; "Coder:
  read-write, exec, web on"; "Sandboxed analyst: read-write, exec, no web") may be better UX
  than four independent switches, with an "advanced" expander for the raw axes. Presets also
  dodge nonsensical combinations.
- **Granularity.** Is `filesystem: read_only` worth it, or is the honest set just
  `code_execution` + `network` (the two with real security weight), leaving read/write always
  on? Read-only is hard to make a true boundary anyway (Pi `read` vs `write` is tool-plane
  only; real fs confinement is sandbox-plane and neither backend does it yet).
- **Where it sits.** A nested `capabilities` object on `AgentConfig`, parallel to `tools`, vs.
  flattening onto the existing run-selection (`harness`/`sandbox`/`permission_policy`). I lean
  nested object: it is a coherent concept and the schema/inspect/table machinery from
  `proposal.md` Part 2 wants one keyed block.
- **Relationship to `permission_policy`.** `permission_policy` (auto/deny) is a *third* plane
  (gate a call the model already made). It overlaps "code_execution: off" partially (deny
  blocks Bash too) but is coarser (all-or-nothing, Claude-only). I think capabilities should
  *subsume* the intent and `permission_policy` stays as the runtime HITL knob, not a capability
  axis. Worth a Codex opinion.

## How it flows end to end (Daytona example, `web: off`)

1. Author sets `capabilities.network: off` in the playground. Stored on the agent config.
2. SDK parses it onto `AgentConfig.capabilities`, copied onto `SessionConfig`.
3. `ClaudeHarness._to_harness_config` reads it and emits `disallowed_tools: [WebFetch,
   WebSearch]` (tool plane). `PiHarness` emits nothing for the tool plane (no web tool to drop)
   but records the intent.
4. The backend (`SandboxAgentBackend` for Daytona) reads `capabilities.network: off` and, at
   `create_sandbox`, sets the provider's `networkBlockAll: true` (sandbox plane).
5. The TS runner applies both: Claude session created with the disallowed tools; the Daytona
   provider `create` object carries `networkBlockAll`.
6. Result: Claude has no web tools AND the VM has no egress. Pi has its tools but the VM has no
   egress, so its `curl` fails closed. Defense in depth, both harnesses safe.

Same config on **local sidecar**: step 3 still works (Claude loses the web tools). Step 4
cannot: the local provider is the host, no `networkBlockAll`. So the backend must declare it
**cannot enforce `network`** and the config must fail loud (or require an explicit
`allow_unsafe_local: true`), per the static capability table + fail-loud rule in
`proposal.md`. This is the honest-degradation requirement.

## How it works for the unimplemented local SDK backend

This is the portability test, and the model passes it cleanly *if* policy lives in the SDK:

- **Tool plane is backend-independent.** It is owned by the `Harness` adapter, which is the
  same object regardless of backend. So `capabilities -> Pi --tools / Claude allowedTools` is
  computed once in Python and works for `LocalBackend` (Pi-via-bundled-JS, Claude-via-
  `claude-agent-sdk`) exactly as for sandbox-agent. For the Claude-via-`claude-agent-sdk` path
  this is *especially* clean: `allowedTools`/`disallowedTools`/`permissionMode` are native
  options of that SDK, so the local Claude path enforces the tool plane in-process with no
  runner at all.
- **Sandbox plane degrades the same way as local sidecar.** `LocalBackend` has no sandbox, so
  it declares it cannot enforce `network`/fs isolation, and the same fail-loud rule fires. A
  `LocalBackend` user who wants a true network boundary is told to use a sandboxed backend.

So the SAME `capabilities` block is portable across all backends. What varies is only the set
of guarantees a backend can honor, and that variance is declared in one capability/enforcement
table, not discovered at runtime.

## Port-shape change this forces (the one real structural cost)

`Backend.create_sandbox()` currently takes **no arguments** (`interfaces.py:155`) and
`Environment._sandbox()` calls it parameterless. But network/fs isolation is a *per-config*
decision (set at Daytona create time), not a per-environment one. So either:

- `create_sandbox(policy: SandboxPolicy)` gains a typed sandbox-policy argument threaded from
  the config through `Environment.create_session` -> `_sandbox()` -> `create_sandbox`, or
- a `SandboxPolicy` is attached to the `Environment` at construction (cleaner if sandbox policy
  is environment-scoped, worse if two configs in one environment want different network).

I lean toward threading a `SandboxPolicy` through `create_sandbox`, because the capability is
authored per-agent-config, and one environment may serve several configs. This is the only
load-bearing port change; everything else is additive fields.

## Defense-in-depth: which plane is authoritative?

My position: **enforce in both planes where possible, and treat the sandbox plane as the
source of truth for any capability with security weight (network, fs).** The tool plane exists
to (a) shape what the model attempts (better behavior, fewer wasted denied calls) and (b)
cover backends with no sandbox plane, as best-effort. Never advertise a tool-plane restriction
as a guarantee when the sandbox plane is absent. This is the single most important correctness
rule in the whole design, because it is where "we told the user web was off" can be a lie.

## Strawman capability x (harness, backend) enforcement table

What each pairing can actually guarantee, which the static table should encode:

| Capability | Pi tool plane | Claude tool plane | Daytona sandbox plane | Local sidecar / LocalBackend sandbox plane |
| --- | --- | --- | --- | --- |
| network off | n/a (no web tool; curl remains) | drop WebFetch/WebSearch | **enforce** (networkBlockAll) | **cannot** (host network) -> fail loud |
| network allowlist | n/a | n/a (no per-host tool gate) | **enforce** (networkAllowList CIDR) | **cannot** -> fail loud |
| code_execution off | drop `bash` (and tool-relay code tools?) | disallow Bash/KillShell + permissionMode | partial (cannot un-install interpreters) | tool plane only |
| read_only | drop write/edit/bash | disallow Write/Edit + Bash | no fs confinement today | no fs confinement |

The "n/a" cells are the honest gaps: Pi's lack of a web tool means its web access is purely a
sandbox-plane concern, and Claude's tools have no per-host web gate, so a network *allowlist*
is sandbox-plane only for both. This table is why network must be sandbox-plane to be real.

## My recommendation (to be challenged)

1. Add a neutral `capabilities` object to `AgentConfig` with `code_execution` (bool) and
   `network` (off/on/allowlist) as the two axes with real weight; treat `filesystem` as a
   later, mostly-tool-plane nicety. Offer presets in the UI over the raw axes.
2. Enforce in two planes, policy decided in the SDK: `Harness` adapters own the tool plane,
   `Backend` owns the sandbox plane. The runner only applies.
3. Make the sandbox plane authoritative for network/fs; the tool plane is UX + best-effort.
4. Declare per-backend enforceability in the static capability table (`proposal.md` Part 2)
   and fail loud when a config asks for a guarantee a backend cannot honor (with an explicit
   unsafe-opt-out for local dev).
5. Thread a `SandboxPolicy` through `create_sandbox`; accept that as the one structural port
   change.
6. Prerequisite cleanup (already latent bugs): the runner must actually honor Pi
   `builtin_names` on the sandbox-agent path (it is dropped today) and must set Claude
   `allowedTools`/`permissionMode` on session creation (never set today). Without these the
   tool plane does not exist.

## Questions for Codex

1. Are two planes the right decomposition, or is there a cleaner single seam I am missing?
2. Capability config shape: booleans vs presets vs per-tool; is collapsing read/write right?
3. Is the sandbox-plane-authoritative + tool-plane-as-UX rule the correct stance, or should we
   refuse configs whose guarantee cannot be met rather than offer best-effort?
4. The `create_sandbox(policy)` port change: thread per-call, or attach to `Environment`?
5. Does putting tool-plane policy in the `Harness` adapter and sandbox-plane policy in the
   `Backend` keep the "backend is pure plumbing" invariant, or does sandbox-plane policy
   actually belong in `Environment` (which already owns sandbox policy)?
6. Anything that breaks the portability claim for the in-process `claude-agent-sdk` local path?
