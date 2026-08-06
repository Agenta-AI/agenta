# WP-5: Chat vs completion interface

Status: not started. Feeds the interface in WP-2.

## Goal

Decide the interface contract an agent exposes, comparing Agenta's chat and completion
shapes. Working assumption: start with chat, with a single input. Agents are multi-turn and
conversational, so chat is the natural fit, and a single input keeps the first cut small.

## Scope

In:

- Compare the existing completion and chat service contracts in Agenta (request shape,
  input handling, response shape, streaming).
- Define a minimal v1 agent contract: chat with one input. Spell out the request, the
  response (which is multi-message, see WP-4), and how a turn maps to a Pi prompt.
- Identify what is deferred: multiple inputs, structured inputs, tools exposed as inputs,
  history handling.

Out:

- Implementing the service (WP-2). This WP produces the contract WP-2 implements.
- The full multi-message output schema (WP-4 owns that; this WP references it).

## Approach (grounded in research)

- Pi is driven turn by turn (`prompt` / `followUp` / `steer`) and threads a `session_id`,
  which lines up with chat semantics.
- Lean on the existing chat contract so an agent can sit beside the other workflow types in
  the playground with minimal new surface.

## Definition of done

- A short decision doc: chat selected over completion (with the reasoning), the minimal
  single-input chat request/response contract for v1, and the path to richer inputs and
  multi-turn history later.

## Open questions

- How conversation history is held: in the Pi session (`session_id`) only, or also passed
  in the request.
- Whether v1 is single-turn (one input, one multi-message answer) or already multi-turn.
- How the single-input chat contract reconciles with the multi-message response from WP-4.

## Links

- [`wp-4-multi-message-output/`](../wp-4-multi-message-output/README.md)
- [`../research/pi-interaction.md`](../research/pi-interaction.md)
- [Project README](../README.md)
