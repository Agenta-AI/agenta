# Port design: sandbox provider, harness, and tool delivery

This document is the design for Phase 3 of the runner decomposition: turning three implicit seams
in the runner into three explicit interfaces, each with a single dispatch point. It is written for
a reader who understands the product but does not write TypeScript. The design is ready to
implement; the implementation is deferred to a follow-up so that each seam can be checked with a
real end-to-end run, because these three areas control runtime behavior that the unit tests do not
fully exercise (the same lesson as the daemon.ts path finding in the handoff).

The goal of all three ports is the same. Today, "which provider is this" and "which harness is
this" are answered by scattered boolean checks (is it Daytona, is it remote, is it Pi) spread
across many files. Adding a new provider (for example E2B) or a new harness (for example Codex)
means finding and editing every one of those checks. The ports replace the scattered checks with
one object per provider and one object per harness that DECLARES its traits, plus one place that
reads those declarations. After the change, "add a provider" and "add a harness" each become "write
one object that declares its capabilities and register it in one place."

## Seam 1: the sandbox provider

A sandbox provider is the thing that creates and runs the sandbox where the agent executes. Today
there are two: a local Docker-style provider and Daytona. The runner leans on an embedded library
called `sandbox-agent` for the basics (create, destroy, filesystem, run a process, get a URL). The
port is a thin adapter over that library; it owns only what the library cannot do.

Two independent axes, never one boolean. The first axis is "is this sandbox remote", meaning it is
reachable only through a filesystem API, with no host directory mounted and no loopback network.
The second axis is "which provider is this" (local, Daytona, E2B). These are different questions and
must not be collapsed into a single flag. Both are expressed as declared capability flags on the
provider, not as booleans re-derived at each call site.

Capabilities each provider declares:
- is remote (the first axis above).
- whether the working directory is a FUSE mount. This drives where the tool relay is placed and the
  logic that remounts the working directory after a transport disconnect (the ENOTCONN handling in
  acquireEnvironment today).
- whether the provider can enforce a network egress policy. Daytona can. Local and E2B cannot, and a
  run that requests such a policy on those providers must be refused, not silently allowed.
- whether the provider can inject runtime-provided credentials. Today this is gated behind an
  explicit "is it Daytona" check; it becomes a declared capability instead.
- who installs the harness binary. For Pi the runner installs it; for other harnesses the sandbox
  image or daemon bakes it in.

Keepalive is a declared trait, because providers keep sandboxes alive very differently. Daytona
keeps itself alive with native idle autostop, so the runner does nothing. An E2B-style provider
needs the runner to run a refresh loop keyed on a stable sandbox id, because the embedded library
never hands back the raw provider handle, so any out-of-band keepalive call needs the id plus the
ambient environment. Every provider must also set a create-time self-reap backstop (an autostop, an
autodelete, or a timeout) that still fires if the runner process dies, so a crashed runner never
leaks a running sandbox.

Lifecycle surface the port owns beyond the library: connect and reconnect (Daytona has a full state
machine and reconverges its network policy on reconnect; other providers may do nothing), pause, and
refresh-activity. Create, destroy, filesystem, process, and get-url all delegate straight to the
library. The port also owns a real type for the create options (both create paths cast to `any`
today; give them a typed shape) and the capability declaration itself.

Filesystem part of the port: make-directory, write, and read, each with built-in containment so a
path can never escape the working directory, and each aware of path flavor (host operating-system
separators for a local sandbox, always POSIX separators for a remote one). Process part: run an
argument vector directly, never through a shell.

Single dispatch point: the provider registry stays the one admission point. The known provider ids,
which are enabled, and which are planned live in `runner-config.ts`, and there is exactly one
dispatch in `provider.ts` (its `buildSandboxProvider` is the seed to grow into this port). E2B and
Docker then slot in by writing one provider object with its capability declaration and registering
it; no turn logic changes.

## Seam 2: the harness

A harness is the coding agent that runs inside the sandbox (Pi, Claude, Codex, Opencode). The
harness port models everything that differs per harness so that adding one is writing a single
object.

Credential material is per harness and splits into environment variables versus a file:
- Pi uses an environment variable or the file `~/.pi/agent/auth.json`.
- Claude uses the `ANTHROPIC_API_KEY` environment variable in managed mode, or the file
  `~/.claude/.credentials.json` when the user logs in with their own account.
- Codex uses the `OPENAI_API_KEY` environment variable and ALWAYS also writes a `~/.codex/auth.json`
  file, even in managed mode.
- Opencode uses environment variables only.
So the shape is: a set of environment keys, plus an optional credential file described by its path,
how it is rendered, and whether it is required even in managed mode.

Own-login uploads use strict per-file allowlists, never a whole-directory copy. Uploading the entire
`~/.claude` directory once leaked the `.mcp.json` tokens and other settings secrets. Config that is
rendered fresh for the run must win over any uploaded host file.

Asset preparation is owned by the harness and dispatched in exactly one place, keyed on the harness
id, and only when the provider is remote. An earlier attempt grew three competing places for this;
the port collapses them to one.

Model naming differs per harness (provider-then-id, or an alias, or a bare id), plus capability
flags such as whether the harness has built-in tools (only Pi does), its connection modes, and its
deployments.

One coupling to protect: the daemon blanks a fixed set of credential environment variables before
applying fresh ones (the known-env-vars list in `daemon.ts`). That list must stay a superset of
every harness's environment keys. The harness port's documentation must say, in one sentence, that
adding a harness means extending that list, or a stale key from a previous run could leak into the
next.

## Seam 3: tool delivery

There are three ways tools reach the agent today, and one policy question that decides which tools
are even deliverable. The port puts the three mechanisms behind one interface and computes the
policy in one place.
- The Pi bundled extension: for a Pi harness, tools ride along inside Pi's own Agenta extension, and
  every tool call relays back to the runner.
- Loopback HTTP: for a local sandbox, tools are served over a loopback HTTP relay.
- In-sandbox stdio shim: for a remote sandbox, a small stdio MCP shim inside the sandbox forwards
  tool calls.
The one policy: "which tools are deliverable for this harness and this sandbox". For example, a
remote non-Pi sandbox's stdio shim delivers only executable (gateway or callback) tools and omits
client-kind tools, so a run whose tools are all client-kind on that path has nothing to advertise
and must be refused. That deliverability rule is computed in exactly one place instead of being
re-derived at each mechanism.

## How E2B and Docker slot in without touching turn logic

With the three ports in place, E2B is a new sandbox provider object that declares: is remote true,
working directory is a FUSE mount true or false depending on its filesystem, can enforce network
policy false (so a policy request is refused), keepalive is a runner refresh loop keyed on a stable
sandbox id with a create-time self-reap backstop, harness binary owner is the sandbox image. Docker
is a provider object that declares is remote false and a host mount. Neither requires any change to
`run-turn.ts` or the acquire logic, because the turn and acquire code reads capabilities and
dispatches through the single points rather than asking "is it Daytona" inline.

## Why implementation is deferred

Each of these three consolidations moves currently-scattered runtime logic into one place. That is
exactly where a subtle behavior difference can hide (the order of capability checks, an edge case in
the deliverability rule, a credential file that must be written even in managed mode). The runner
unit suite is strong but, as the daemon.ts package-root finding showed, does not fully guarantee
runtime behavior. So the port implementation should land in a focused follow-up that runs the agent
release gate and a real end-to-end run against a live deployment, ideally after the pi-openai PRs
(#5345 and #5346) land so the port work does not fight a rename conflict on `daytona.ts` and
`pi-assets.ts`. Phase 1 (the decomposition) is independent of all of this and ships now.
