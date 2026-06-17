# WP-2: Agent service wrapping Pi

Status: not started.

## Goal

Stand up a new service that wraps Pi and exposes an interface like Agenta's completion/chat
services, so we can talk to an agent: set it up (auth, AGENTS.md), send a message, and get response streamed back. Local only for the POC. No Daytona yet.

Basically we want:

- A new docker service that has the same structure as completion and chat
- that opens endpoints for the same interface as chat
- that you can send a message history and context and get back response 




## Scope

In:

- A thin TypeScript harness-wrapper that drives Pi's SDK (`createAgentSession`).
- Configure the agent fully in memory: AGENTS.md, LLM auth, model. Skills and custom tools
  can be stubbed for the first cut.
- Expose our own protocol on a port: a send-message / get-response surface that mirrors the
  shape of the existing completion/chat services.

Out (later work packages):

- Daytona sandbox. The wrapper runs as a local process for the POC.
- Swapping in other harnesses (Codex, Claude Code). Design the protocol so it is possible,
  but only implement Pi here.
- Persisting sessions or storing config server-side. Use a config passed in at startup.
- Stream the multi-message output back to the caller.
- multimessages
- tools

In step 1 we will hard code the auth for pi.dev (the openai api key for instance or codex). We wont have any configuration just ability to run things. The docker compose will be reloadable automatic change which mean we can simply change the files in the volume locally and change things there. 

We will make sure in the implementation to first think about the port and adapters. So that even the first MVP is very simple it has the right ports and adapters. 

First between our agent implementation and calling pi.dev and setting it up there is a clear port. pi is an implementation for this. 

there is also another port for setting up the run environment. So it's not just setup the agent but also the run environment. 

because you might run pi.dev or claude code locally. As you might run each in daytona or something else. 

We need to set these up. EAch with an adapter. starting env - shutting down - pausing - connecting volume - 

then set up pi.dev setting up - invoking - stoping? (all the rpc interactions) - shutting down 

For pi.dev it might make sense to have two adapters one for RPC and the other for json 

Success for this WP1 is:
- I go to the UI
- Create a new agent (with some hard coded config Say hello world)
- I run it in the playground and I see the output. 

note here that instrumentation here might needed, we are working in parallel on the research for that


As soon as we have that we can start working on adding a config first to the playground. which include agents.md then authentication (model used) then setting up tools. then we can talk about streaming, multi messages, intermediate messages. 




--- The rest of the article might be out of date for some parts. The main requirements are above ---


## Approach (grounded in research)

See [`../research/pi-interaction.md`](../research/pi-interaction.md),
[`../research/auth-secrets.md`](../research/auth-secrets.md), and
[`../research/diskless-in-memory-config.md`](../research/diskless-in-memory-config.md).

- Use the **SDK**, not RPC. The SDK is what exposes the in-memory overrides and runtime
  credential injection; RPC mode cannot inject credentials post-spawn.
- Inject everything in memory:
  - AGENTS.md via `systemPromptOverride` / `appendSystemPrompt` / `agentsFilesOverride`,
    with `noContextFiles` so no on-disk AGENTS.md leaks in.
  - LLM auth via `setRuntimeApiKey(provider, key)` or `AuthStorage.inMemory()` (env at
    spawn also works).
  - State via `SessionManager.inMemory()`, `SettingsManager.inMemory()`,
    `ModelRegistry.inMemory()`.
- Diskless: set `TMPDIR` to a per-run tmpfs for bash output spillover; pre-install `rg`/`fd`
  so search tools do not write binaries to disk.
- Stream output via `session.subscribe()` callbacks (`message_update` -> `text_delta`),
  mapping Pi events onto the service's streamed response.
- This wrapper is the "works with our port" contract and the swappable-harness seam. Keep
  the protocol harness-agnostic.

## Interface to mirror

Match the existing Agenta completion/chat service surface so callers and the playground can
treat an agent like the other workflow types. Reconcile the single-output completion/chat
shape with Pi's multi-message output (the response is a list of messages, not one
completion).

## Definition of done

- The service starts locally with a passed-in config (AGENTS.md text, model, provider key).
- A caller can send a message and receive the streamed multi-message response.
- Auth and AGENTS.md are applied in memory, with nothing invocation-specific written to a
  persistent disk.
- The same wrapper binary runs as a plain local process (parity baseline for later sandbox
  and pull-config-and-run-locally work).

## Open questions

- Where the service lives in the repo (a new entry under `services/`, or alongside `api/`),
  and how a Node service fits the Python backend. Decide before writing code.
- The exact protocol on the port (JSON-lines over stdio, a small HTTP/SSE server, or
  websockets). Pick the one that matches how Agenta calls completion/chat today.
- How the multi-message output maps to the completion/chat response contract.
- Whether WP-1's tracing extension is embedded here from the start or added after.

## Links

- [`../research/pi-interaction.md`](../research/pi-interaction.md)
- [`../research/auth-secrets.md`](../research/auth-secrets.md)
- [`../research/diskless-in-memory-config.md`](../research/diskless-in-memory-config.md)
- [`../research/sandbox-sharing.md`](../research/sandbox-sharing.md)
- [Project README](../README.md)
