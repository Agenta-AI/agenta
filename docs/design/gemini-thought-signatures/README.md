# Gemini thought signatures in the tool call id

This folder plans one change that moves Gemini thought signatures into the Agenta LLM
gateway. Today a Pi extension in the runner keeps signatures, and the gateway fills the gaps
with a value that turns off Google's check. After the change, the gateway carries each
signature inside the tool call id on the way back to the client, and it puts the signature
back where Gemini reads it on the next request. The skip value and the runner extension are
deleted in the same PR. This is an architecture change, and it is not expected to fix the
`malformed_function_call` seen in production.

The code baseline is `origin/release/v0.122.6` at `090e8bd81b`. The local workspace checkout
is older and does not have the code this plan changes.

## Reading order

| File | Answers |
| --- | --- |
| [context.md](context.md) | What goes wrong today, and why we are changing it. |
| [design.md](design.md) | The wire shape, the code change in each file, the costs, the tests, and the open questions. Read this one first if you read only one. |
| [research.md](research.md) | What we found in the code, in Pi, and in LiteLLM, with file and line references. |
| [plan.md](plan.md) | The order of work and how to check it on a live stack. |
| [status.md](status.md) | Where the work stands. |

## Terms used in every file

- **Gateway**: the Agenta LLM gateway in `api/oss/src/core/gateways/llms/`. It relays a
  chat completions request to the provider and relays the response back.
- **Pi**: the agent harness the runner (`services/runner`) drives. Pi talks to the gateway
  in the OpenAI chat completions format.
- **Thought signature**: an opaque base64 string Gemini 3 returns with a tool call. Gemini
  wants it back, unchanged, when the next request sends that tool call in its history.
- **Google's OpenAI-compatible endpoint**: the chat completions API that Google serves for
  Gemini, on Vertex (deployment kind `VERTEX`) and directly (provider key `gemini`). The
  gateway reaches Gemini only through this endpoint.
- **Skip value**: `skip_thought_signature_validator`, a fixed string that Google accepts in
  place of a signature. Google documents that it costs reasoning quality.
- **Current turn**: Google's term for every message after the latest user message that is not
  a tool result. Google checks signatures only on tool calls in the current turn.
