# Where an agent's code actually runs, and why it is a multi-tenant risk

Plain-language walkthrough of how an agent runs code today, who runs it, where it runs, and
where the isolation breaks for a multi-user cloud. Written to answer the confusion directly.
The verified per-cell map and the formal options are in `research.md` and `proposal.md`; this
page is the explanation.

## A note on the names first, because it is half the confusion

Two things are easy to mix up, so this doc uses the concept name and the deployable service
name deliberately.

- **The agent runner** is the shared sidecar process we own. It runs the agent loop, holds the
  resolved tools and their secrets, and drives the harness. The deployable service and image
  are called `sandbox-agent`; services reach it through `AGENTA_AGENT_RUNNER_URL`.
- **A harness** is the actual agent brain that plugs into the runner: Pi today, Claude Code and
  Codex next, as many as we add. The runner drives whichever one a request selects.

The risk in this doc is about **the runner, not about Pi.** A custom code tool runs back on the
shared runner the same way for every harness. Pi gets its tools through our Pi extension; Claude
gets them through a synthesized MCP server. In both cases the harness is handed only the tool's
public spec, and the code executes back on the runner. So this is not a Pi-adapter bug. It is
how the runner runs custom code for all harnesses.

## The one-line answer

There are two different ways an agent runs code, and they run in two different places.

1. **The harness's own built-in tools** (for Pi that is `bash`/`read`/`write`; Claude Code and
   Codex have their own) run **inside the agent's own session.** On Daytona that is the
   per-session cloud sandbox. On the local backend it is the shared agent runner.
2. **A custom "code tool"** (the snippet an author attaches to the agent) **always runs in the
   shared agent runner, never in the sandbox**, on every backend and every harness. This was a
   deliberate choice to keep the author's code and secrets off the sandbox, and the side effect
   is that the code runs in the shared box.

On the current default (sandbox-agent backend, `local` sandbox) there is no separate sandbox at all, so
**both** kinds run in the one shared runner. That is the heart of the risk.

## First, the two things people call "running code"

People say "the agent ran code" for two mechanisms that are wired completely differently.

**The harness's built-in tools.** Each harness ships its own. Pi has `bash`, `read`, `write`,
`edit`; Claude Code and Codex have their own equivalents. They are part of the harness, not
something we built. We only tell the harness which ones to allow, and the Agenta harness forces
Pi's `read` and `bash` on for every agent. With `bash`, an agent can write a file and run `node`
or `python3` on it. We do not execute these. **The harness does, inside its own process.**

**Custom code tools (ours).** This is the `type: "code"` tool an author attaches: a Python or
Node snippet plus the secrets it needs. We built this whole path. The snippet and its secrets
are resolved on the server and kept on the runner. The harness is told only the tool's name,
description, and input schema, never the code. When the model calls the tool, the call is
relayed back to the runner, the runner executes the snippet, and only the result goes back. This
is identical across harnesses: Pi receives the tool through our Pi extension, Claude through a
synthesized MCP server, but either way the code runs back on the runner.

These two are the key to everything below. A built-in tool runs where the harness runs. A custom
code tool runs where the runner runs. Those are not always the same place.

## Where each one runs

The runner is the shared agent-runner process (the sidecar we own, the container currently
named `sandbox-agent`). The sandbox is the agent's per-session environment. There are three backends.

- **In-process** (local/example contrast path): the harness runs inside the runner. No
  separate sandbox.
- **sandbox-agent + local** (the current default): `sandbox-agent` runs the harness *on the same host*,
  inside the runner container. The "sandbox" is just a child process in the same box. No real
  isolation.
- **sandbox-agent + Daytona**: `sandbox-agent` creates a remote Daytona cloud sandbox and runs the
  harness *there*. This is the only backend with a real, separate, per-session box.

Here is the same fact as a table. "runner" means the shared agent-runner container. "Built-in"
shows Pi's `bash`; another harness's built-ins behave the same way (they run where the harness
runs). The custom-code-tool row is identical for every harness.

| What runs | In-process | sandbox-agent + local | sandbox-agent + Daytona |
| --- | --- | --- | --- |
| Built-in `bash` / `node` via bash | runner | runner | **the Daytona sandbox (isolated)** |
| Custom code tool (python/node) | runner | runner | **runner (relayed out of the sandbox)** |

Read the Daytona column carefully, because it is the surprising one. A built-in tool runs in the
isolated sandbox, which is what you would expect. But a custom code tool does **not**. It is
relayed back out to the shared runner and executed there. So even on Daytona, an author's code
tool does not get the sandbox isolation.

## The flow, step by step

A **custom code tool on Daytona** (the surprising case):

```
1. The model, running in the Daytona sandbox, decides to call secret_math(6).
2. Pi (in the sandbox) only knows the tool's name + schema. It does NOT have the code.
3. Pi writes a "call secret_math with {x:6}" request file into the sandbox.
4. The agent runner (shared, back on our host) is polling that sandbox over the file API.
   It reads the request.
5. The runner looks up the real spec it kept in memory (the python/node snippet + secrets)
   and runs it.            <-- THE AUTHOR'S CODE EXECUTES HERE, in the shared runner.
6. The runner writes the result file back into the sandbox.
7. Pi reads the result and continues the conversation.
```

The snippet and its secrets never enter the sandbox. That was the point. The cost is that the
code runs in the shared runner.

A **built-in bash command on Daytona** (the expected case):

```
1. The model, in the Daytona sandbox, decides to run `node foo.js`.
2. Pi (in the sandbox) runs bash itself.   <-- RUNS HERE, inside the per-session sandbox.
3. The result goes back to the model.
```

On **sandbox-agent + local** (today's default), step 5 and step 2 happen in the same place: there is no
separate sandbox, so the harness and the runner are the same box. Built-in bash and the relayed
code tool both run in the one shared container.

## Your "it used node to reach the internet" story, explained

That is exactly this system working as built, and it shows the risk in one shot.

"No Python" is finding F-006: the runner image did not have `python3` installed, so a Python
code tool failed and only Node worked. (We fixed that; it is unrelated to the security point.)
"It wrote a file and ran it with node and reached the internet" is the core issue: the Node
executed in the shared agent runner (default backend) with that runner's full network
access. Nothing about the per-session sandbox applied to it. On a single-user box that is fine.
On a shared cloud it is the problem.

## A sharper exposure: built-in bash sees the provider keys

This one is worth stating plainly because it is the bigger leak, and the Agenta harness turns
it on by default.

To let Pi call the model, the runner injects the project's provider API keys into Pi's
environment (the code literally comments "local daemon inherits the provider keys"). Pi's
built-in `bash` runs as a child of Pi, so it inherits that environment. So a forced-`bash`
agent can read `OPENAI_API_KEY` (and any other injected provider key) with a one-line `env`
command.

Note the asymmetry. The custom code-tool path is careful here: it scrubs the environment down
to an allowlist (PATH, HOME, locale, temp) plus only the tool's own declared secrets, so a code
tool does not see provider keys. The built-in `bash` path has no such scrub. So the tool we
worried about (custom code) is the better-contained one, and the tool we force on by default
(built-in bash) is the more exposed one. (Verify whether Pi scrubs its own bash env before
treating this as final, but the runner-side wiring points this way.)

## Who built it this way, and why it is a trade-off, not a bug

Nobody decided "run tenant code in a shared box." Two separate, reasonable choices add up to it.

The relay (custom code runs on the runner, not the sandbox) is a **secret-safety** design from
the tool work. The reasoning was: the author's code and the tool's secrets are sensitive, so
keep them on the trusted runner and never ship them into the sandbox, where a compromised or
shared sandbox could read them. That is a real benefit. The side effect, which was not the
focus at the time, is that the code then runs in the runner, and the runner is shared.

Built-in `bash` running inside Pi is **Pi's own design**, not ours. We just choose to force it
on (so agents can use skills and shell). On Daytona that lands in the isolated sandbox, which is
fine. On local it lands in the runner.

So the gap is the intersection of "we share one runner across agents" and "execution lands in
that runner." Neither half was wrong alone.

## The multi-tenant cloud requirement, and what breaks it

Your requirement for Agenta cloud is clear and correct: no agent may touch anything belonging to
another agent. Hold today's system against it.

What is already safe:
- Provider-key leakage **through a custom code tool's env**: blocked by the allowlist.

What is not safe on a shared runner (one agent runner serving more than one tenant):
- **Network.** Code reaches the open internet as the runner. It can exfiltrate anything it can
  read, and it can call internal services the runner can reach.
- **Filesystem.** The snippet runs as the runner user with no namespace or chroot. It can read
  and write files outside its temp dir, including other runs' relay files and anything else in
  the container.
- **Other tenants' runs.** Concurrent runs share the process space. A snippet can inspect
  `/proc`, read sibling process command lines and (conditionally) memory, and tamper with the
  unauthenticated relay files another run is using.
- **Denial of service.** There is no CPU, memory, file-descriptor, or process-count cap, and the
  per-call timeout kills only the immediate child, not its process group. One snippet can starve
  every other tenant on that runner.
- **Provider keys via built-in bash**, as above.

Important scope: this only matters when one agent runner is shared across tenants. A
single-tenant or self-hosted deployment, where the box belongs to one customer, is not exposed.
So the question is entirely about the shared cloud you are about to run.

## Options

Four ways to close the gap, with honest costs. They are not exclusive.

1. **Keep running code in the runner (today).** Code and secrets never enter the sandbox. Cost:
   no per-tenant isolation on a shared runner. Fine for single-tenant or self-host. Not safe for
   shared cloud as-is.
2. **Run code in the per-session sandbox (Daytona).** Real isolation per agent, which is exactly
   the boundary you want. Cost: you must ship the snippet and its scoped secrets *into* the
   sandbox, which inverts the secret-safety property option 1 was built for, and the sandbox
   needs the runtime (python3/node). It also splits the code path from the gateway/callback path.
3. **Harden the runner subprocess into a real jail.** Network-deny by default, mount and PID
   namespaces, seccomp, cgroup CPU/memory/pid limits, output caps, a separate low-privilege UID,
   process-group cleanup. Keeps one delivery model and also covers built-in bash. Cost: only
   worth it if it is a *full* jail; a partial one is false comfort. Built-in bash's env still
   needs scrubbing separately.
4. **Per-tenant or per-run isolated worker (container or microVM).** Each tenant (or each run)
   gets its own runner, so "specs stop at the runner" still holds but the shared-OS boundary is
   gone. Cost: orchestration and cold-start overhead.
5. **Run code tools as custom workflows.** Agenta already has a workflow/evaluator execution
   boundary for custom code evaluators. Put a `ToolRunner` abstraction between the agent runner
   and tool execution. In cloud, the `ToolRunner` invokes a custom workflow/code-evaluator style
   revision through the services sandbox runner. Locally, another adapter can run the same tool
   in the developer's checkout or environment. The important rule: local execution is a trusted
   developer mode, not a shared-cloud isolation mode.

## Recommendation

For Agenta cloud with many users, a shared agent runner is not acceptable for code execution.
Pick one of:

- **Option 5 (custom-workflow ToolRunner)** as the Agenta-native target. It reuses the entity,
  versioning, workflow invocation, tracing, and code-evaluator sandbox runner we already have.
  The cloud adapter must use an isolated services runner such as Daytona, not the local runner.
- **Option 4 (per-tenant/per-run workers)** if you want to keep the current relay design and its
  secret-safety property. This is the cleanest fit for the requirement: isolation by giving each
  tenant their own runner, no rewrite of the code path. Use it if the workflow/evaluator runner
  cannot meet latency or lifecycle needs.
- **Option 3 (full jail)** as the floor if a shared runner must stay, accepting that it has to be
  a real jail and that built-in bash needs its own env scrub.
- **Option 2 (run in the Daytona sandbox)** where you specifically want a separate-kernel
  boundary, accepting the secret-delivery rework.

Whatever the choice, two smaller items ride along regardless: scrub the provider keys out of the
built-in `bash` environment (or stop forcing `bash` on by default), and make the relay files
authenticated so a sibling run cannot tamper with them. The single-tenant and self-host
deployments do not need any of this; the decision is purely about the shared cloud.

## What to check yourself (file pointers)

- Custom code tool relays, then runs on the runner: `services/agent/src/tools/dispatch.ts`
  (`runResolvedTool`, the `code` branch and the relay branch), `services/agent/src/tools/relay.ts`
  (`executeRelayedTool` runs `runCodeTool`), `services/agent/src/engines/sandbox_agent.ts`
  (`startToolRelay`, the loop that polls the sandbox from the runner).
- The snippet executes via a subprocess with an env allowlist:
  `services/agent/src/tools/code.ts` (`runCodeTool`, `BASE_ENV_ALLOWLIST`, `buildChildEnv`).
- Only public specs reach the harness (so it cannot run the code itself, it must relay):
  `services/agent/src/tools/public-spec.ts` (`publicToolSpecs`),
  `services/agent/src/extensions/agenta.ts` (`registerTools`).
- Local sandbox-agent runs Pi on the host (no separate sandbox): `services/agent/src/engines/sandbox_agent.ts`
  (the `local({ env, binaryPath })` provider) vs `daytona({ create, ephemeral })`.
- Provider keys are injected into Pi's env: `services/agent/src/engines/sandbox_agent.ts`
  (`Object.assign(env, secrets)`, commented "local daemon inherits the provider keys").
