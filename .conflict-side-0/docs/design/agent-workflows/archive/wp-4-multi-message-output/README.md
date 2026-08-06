# WP-4: Multi-message output shape

Status: not started. Feeds the interface in WP-2.

## Goal

Define how an agent's multi-message output is represented, streamed, stored, and surfaced,
and how it maps onto Agenta, whose existing workflows (completion, chat) return a single
output. This is a design and investigation task, not a service build.

## Scope

In:

- The output schema: an agent run returns a list of messages, each with content blocks
  (text, image, tool calls / results), not one completion.
- The streaming contract: how partial messages arrive (`message_update` -> `text_delta`)
  and how a consumer assembles the final list (`agent_end.messages` / `session.messages`).
- The mapping onto Agenta's storage and display: how a message list fits the current
  output/trace data model, and how the playground and observability would render it.
- How images and other non-text blocks are carried (base64 content blocks; Pi also has
  `generateImages()`).

Out:

- Building the service (WP-2) or the tracing (WP-1). This WP produces the schema and mapping
  those depend on.

## Approach (grounded in research)

See [`../research/pi-interaction.md`](../research/pi-interaction.md).

- Pi streams via `subscribe()` callbacks and exposes the full set on `agent_end.messages`.
- Structured output uses a terminating tool (TypeBox schema), read from the tool args.
- Examine Agenta's existing output model and the trace ingestion so the message list and the
  span tree (WP-1) tell a consistent story.

## Definition of done

- A written schema for agent multi-message output, with the streaming contract.
- A mapping from that schema onto Agenta's storage and onto playground / observability
  rendering, with the gaps versus single-output workflows called out.

## Open questions

- Reconcile a message list with the single-output completion/chat response contract (ties to
  WP-5).
- Whether non-text artifacts (images, files) are inlined, stored, or referenced.
- How the message list relates to the trace span tree so they do not duplicate or diverge.

## Links

- [`../research/pi-interaction.md`](../research/pi-interaction.md)
- [`wp-5-chat-vs-completion/`](../wp-5-chat-vs-completion/README.md)
- [Project README](../README.md)
