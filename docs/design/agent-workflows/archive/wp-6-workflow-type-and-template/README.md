# WP-6: Agent as a new workflow type and template

Status: not started. Backend integration; ties WP-2, WP-4, and WP-5 together.

## Goal

Register "agent" as a new workflow type in Agenta, define its configuration schema, expose
it as a template users can pick like completion / chat / LLM-as-a-judge, and wire a workflow
invocation to connect to a running agent (the WP-2 service, later the WP-3 sandbox).

## Scope

In:

- Add "agent" as a new workflow type alongside completion / chat / judge, stored and
  versioned as a workflow revision.
- Define the revision configuration schema: AGENTS.md, skills, model, tools, secrets, files,
  and harness (Pi by default, configurable).
- Add a starter template so a user can create an agent workflow with sensible defaults.
- Define the connection: how an invocation routes to the harness over the port, threads
  `session_id`, and streams the multi-message output back.

Out:

- The service implementation (WP-2) and the sandbox (WP-3). This WP defines the type, the
  config, the template, and the connection contract; it does not build the runtime.
- The playground UI for agents. Later.

## Configuration, especially the model

- **Model.** The agent's model must resolve providers and keys through the same path as
  chat / completion (the provider/model resolution aligned in prompt-runtime-unification),
  then be handed to the harness. For Pi that means resolving the provider key (into
  `setRuntimeApiKey` or env) and selecting the model in Pi's `ModelRegistry` (`set_model`).
  Pi supports 15+ providers, and this is also the OpenAI/Codex swap point.
- **Harness.** A config field selects the harness (Pi default, configurable). Decide whether
  the harness choice constrains the available model list.
- **Secrets and files.** Define how secrets (for example an OpenAI key) and config files
  attach to a revision, and how they map to the in-memory injection from the diskless
  finding (`systemPromptOverride` for AGENTS.md, `setRuntimeApiKey` for auth) rather than
  being written to disk.
- **Skills and tools.** How they are declared in config and passed to the harness
  (`skillsOverride` / `customTools`).

## Connection to the agent

- How a workflow invocation reaches the harness: the port contract from WP-2
  (works-with-our-port), `session_id` threading, and streaming the multi-message output
  (WP-4) back through the workflow response (chat-first per WP-5).

## Needs a grounding pass first

The backend workflow-type / template / revision model was not covered in the research round.
Before writing config schemas, investigate how existing workflow types (completion, chat,
judge) are registered, where templates live, and how revision `parameters` are shaped.
The prompt-runtime-unification "Future Directions" sketched giving the judge a shared
`prompt` block; agents would similarly get an `agent` / `harness` block under the revision
parameters. Confirm the actual registration points in `api/`.

## Definition of done

- A documented config schema for the agent workflow type, with model resolution and harness
  selection spelled out.
- A defined connection contract from workflow invocation to the running agent.
- A plan to register the type and ship a starter template.

## Open questions

- Where workflow types and templates are registered in the backend (to confirm in the
  grounding pass).
- Whether the harness choice constrains the available models.
- How secrets and files attach to a revision and reach the harness in memory.
- How agent config maps onto the existing workflow / revision / variant model
  (`artifact.name` is the entity name, `revision.name` is the variant name).

## Links

- [`wp-2-agent-service/`](../wp-2-agent-service/README.md)
- [`wp-4-multi-message-output/`](../wp-4-multi-message-output/README.md)
- [`wp-5-chat-vs-completion/`](../wp-5-chat-vs-completion/README.md)
- [`../research/diskless-in-memory-config.md`](../research/diskless-in-memory-config.md)
- [`../research/auth-secrets.md`](../research/auth-secrets.md)
- [`../../prompt-runtime-unification/README.md`](../../prompt-runtime-unification/README.md)
- [Project README](../README.md)
