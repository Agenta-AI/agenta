# Architecture

This page explains how an agent runs inside Agenta, from the moment a request arrives
to the moment the answer comes back. Read it first. The other pages go deeper into the
[ports and adapters](ports-and-adapters.md), [sessions](sessions.md), and the two
shipped adapters ([Pi](adapters/pi.md), [Claude Code](adapters/claude-code.md)).

## What an agent workflow is

Agenta already runs prompt workflows: completion, chat, and the LLM judge. Each one calls
a model once and returns one answer. An agent is different. It runs a loop. It reads its
instructions, calls a model, runs a tool, reads the result, and calls the model again. It
keeps going until the task is done, then returns the final answer.

This PoC adds the agent as a new kind of workflow. It sits behind the same `/invoke`
endpoint every other workflow uses, traces into the same spans, and reads its config from
the same playground.

The loop itself is not the hard part. Open-source coding agents already run the loop well.
The hard part is running one of those agents *as an Agenta workflow*: behind the standard
contract, traced into the standard spans, with the agent and the place it runs both
swappable by config. That is the problem this architecture solves.

## The core idea: a relay of programs

The system is a relay. Each program starts the next one and passes work down the line. The
prompt travels down the relay, and the answer travels back up.

Here is the whole relay for a normal local run:

```
 browser / playground
     │   POST /invoke
     ▼
 ┌───────────────────────────────────────────────────
 │ CONTAINER 1: "services"   (Python / FastAPI)
 │   the Agenta backend. Parses the request,
 │   gathers config, and calls the runner.
 └───────────────────────────────────────────────────
     │   POST http://agent-pi:8765/run
     ▼
 ┌───────────────────────────────────────────────────
 │ CONTAINER 2: "agent-pi"   (Node / TypeScript)
 │   the sidecar.  server.ts → engines/rivet.ts
 │
 │   rivet daemon                  (subprocess)
 │     └── ACP adapter: pi-acp     (subprocess)
 │           └── pi                (subprocess)   ← the harness
 └───────────────────────────────────────────────────
     │   HTTPS
     ▼
 OpenAI / Anthropic   (the model)
```

Two containers carry the request. Inside the second one, a small tree of processes does
the work. Each box has a clear job, and the next sections name them.

## The two containers

The deployment runs two containers that matter here. Both stay up all the time. You can
see both in `hosting/docker-compose/ee/docker-compose.dev.yml`.

The **`services`** container runs the Python backend. Every Agenta workflow lives here,
including the agent. When you run an agent in the playground, the request lands in this
container. The handler reads the config (which agent, which model, the instructions, the
tools, the provider keys), builds one request, and calls the runner over HTTP.

The **`agent-pi`** container is the sidecar. It runs a small Node web server on port 8765.
Its only job is to receive a `POST /run`, drive the agent, and return the result. The
`services` container reaches it on the internal network at `http://agent-pi:8765`.

"Sidecar" just names a small helper container that runs next to a main one. Two reasons
justify the split. The agent code is TypeScript and the backend is Python, so they want
different runtimes. And the sidecar deliberately holds none of the stack's secrets (it has
no `env_file`), so a sandboxed agent cannot read the platform's Stripe or Composio keys.

## Inside the sidecar: the process tree

The sidecar does not run the agent itself. When a `/run` request arrives, its TypeScript
starts a chain of child processes, and each one starts the next.

1. **The rivet daemon** (`sandbox-agent server`). Our code spawns it as a child process.
   It is a binary from the open-source [`rivet-dev/sandbox-agent`](https://github.com/rivet-dev/sandbox-agent)
   project (Apache-2.0). Think of it as a manager. You tell it "run agent `pi` with this
   prompt," and it handles the work of launching the agent and streaming results back.

2. **The ACP adapter** (`pi-acp`, or `claude-agent-acp` for Claude). The daemon spawns it
   as a child process. It is a translator. It speaks ACP on the side facing the daemon and
   the agent's own protocol on the side facing the agent.

3. **The harness** (`pi`, or the `claude` CLI). The adapter spawns it as a child process.
   This is the real coding agent. It reads the instructions, calls the model, runs tools,
   and loops until the task is done.

All three run as processes inside the `agent-pi` container. They are not separate
containers. They form a parent-child-grandchild tree.

## The vocabulary, defined once

| Term | What it is |
| --- | --- |
| **Harness** | The coding agent program. Pi, Claude Code, and Codex are harnesses. Each is a CLI that takes instructions, calls a model, runs tools, and loops. "Harness" is our umbrella word for "the agent engine." |
| **ACP** (Agent Client Protocol) | A shared language for talking to any coding agent. Without it, each agent has its own API and you write custom glue per agent. With it, you speak one protocol and the agent on the far end is swappable. This is why one config value flips `pi` to `claude`. |
| **ACP adapter** | The translator that makes one specific agent speak ACP. Pi does not speak ACP on its own, so `pi-acp` wraps it. Claude has `claude-agent-acp`. |
| **rivet daemon** | The manager that starts the adapter and harness, hides *where* they run, and streams their events back over ACP. We use it; we did not write it. |
| **Sandbox** | *Where* the agent's process tree runs. `local` means processes inside the sidecar. `daytona` means a throwaway cloud machine. |
| **Sidecar** | The always-on helper container (`agent-pi`) that drives runs. Not the sandbox. The sidecar starts the sandbox. |

## Two axes you can change: harness and sandbox

The whole point of the relay is that two pieces swap independently, by config, with no code
change. The playground exposes both as dropdowns.

- **Harness** chooses *which* agent runs: `pi` or `claude`. It becomes the rivet `agent`
  value, which selects the ACP adapter.
- **Sandbox** chooses *where* the agent's process tree runs: `local` or `daytona`.

The two are orthogonal. You can run `pi` locally, `claude` locally, or `pi` on Daytona, and
each is one dropdown change. The request also carries a **permission policy** (`auto` or
`deny`) that decides how a permission-gating harness like Claude handles tool prompts in a
run with no human watching.

## Local versus Daytona: the same tree, a different place

The relay above is `sandbox: local`. The daemon, adapter, and harness all run as processes
inside the `agent-pi` container, on our own server.

Switch to `sandbox: daytona` and one thing changes. That same tree runs in a Daytona cloud
sandbox instead. Daytona starts a throwaway remote machine, the daemon and adapter and
harness run there, and the sidecar talks to them over HTTP. Everything else is identical.

So the sidecar is not the sandbox. The sidecar is the always-on driver. The sandbox is the
place the agent runs, which is either "processes inside the sidecar" (`local`) or "a cloud
machine the sidecar talks to" (`daytona`).

## The lifecycle: cold per run

Nothing in the process tree stays alive between runs. Only the two containers stay up.
Every invoke starts a fresh daemon, which starts a fresh adapter, which starts a fresh
harness. The run does its work, returns its answer, and then the runner tears the whole
tree down (`destroySandbox` and `dispose` in a `finally` block). The next invoke builds the
tree again from scratch.

This is the **cold** model. It is simple and well isolated, and it has one consequence
worth stating up front: because no session is held between turns, a multi-turn conversation
replays its history on every turn. [Sessions](sessions.md) covers what that means today and
how a warm model could change it tomorrow.

## The other engine: in-process Pi

The relay above describes the **rivet engine**, the default in the deployed stack and the
path the rest of these docs assume. The runner also ships a second engine: **legacy
in-process Pi**. It drives the
Pi SDK directly inside the sidecar, with no daemon, adapter, or ACP in between. It exists
for the simplest local case and as a fallback that does not depend on the rivet daemon.

Both engines sit behind the same Python port and serve the same `/run` contract, so the
choice between them is a deployment detail, not a difference the workflow author sees. The
[ports and adapters](ports-and-adapters.md) page explains how one neutral seam holds both.

## How a request flows, end to end

Putting it together, a single agent run on `pi` / `local` goes like this:

1. The playground sends `POST /invoke` to the `services` container.
2. The Python handler (`agent/app.py`) reads the config, resolves the tools and provider
   keys, and builds a `SessionConfig`.
3. It picks the engine (`rivet`) and the transport (HTTP to the sidecar), then sends one
   `POST /run`.
4. The sidecar's rivet engine starts the daemon, which starts `pi-acp`, which starts `pi`.
5. `pi` reads the instructions, calls the model, runs any tools, and streams events back up
   the relay. Those events become trace spans nested under the `/invoke` span (the
   [Pi adapter](adapters/pi.md) page explains who emits them).
6. The harness finishes. The runner reads the final text and the token usage, tears the
   tree down, and returns one `/run` result.
7. The Python handler records the usage on the workflow span and returns the assistant
   message as the `/invoke` response.

The next pages explain the seam that makes step 3 engine-agnostic, the session model behind
steps 4 to 6, and exactly how each adapter implements step 5.
