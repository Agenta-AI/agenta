# Client-tool interaction lifecycle

Planning workspace for one coherent model of when interaction cards (questionnaire forms,
connect cards, approval gates) render in the agent chat, and how their outcomes reach both
the UI and the model. Born from a day of recurring resurrection/duplication bugs
(2026-08-10); the thesis and symptoms live in [context.md](context.md).

## Reading order

| Question | File |
|---|---|
| Why does this project exist, what did the user see? | [context.md](context.md) |
| How does the system actually behave today (code truth + live evidence)? | [research.md](research.md) |
| What do we change, in what order? | [plan.md](plan.md) |
| Where does the work stand right now? | [status.md](status.md) |

## Glossary (shared by every file here)

- **Interaction**: a request the agent parks the run on, awaiting a user action in the
  chat UI. Kinds today: `request_input` (a questionnaire form, also called elicitation),
  `request_connection` (a connect card for a provider integration), and tool approval
  gates (allow/deny a tool call).
- **Card**: the rendered widget for one interaction.
- **Park**: the runner suspending a turn until the interaction is answered; the stream
  ends while the server-side run stays alive waiting.
- **Interaction row**: the `session_interactions` database row that tracks one
  interaction's status (`pending`, `cancelled`, resolved states).
- **Records / transcript**: the persisted per-session record stream (tracing-backed) the
  server keeps of everything said and done; the frontend can rebuild a conversation from
  it (**replay**) via `transcriptToMessages`.
- **Adoption**: the frontend replacing its in-memory messages with a replay built from
  the server records (on reload, on the records relay ticking, or on hydration).
- **Records relay**: the SSE stream that tells an open tab the session's records changed,
  triggering a refresh that can end in adoption.
- **Runner**: the Node sidecar that executes agent turns against a harness (Pi, Claude,
  Codex). **Harness**: the coding-agent engine the runner drives.
- **Resume**: the follow-up run the client dispatches after answering an interaction, so
  the parked turn continues with the answer.

## Today's landed fixes this project builds on (all 2026-08-10)

- [#5857](https://github.com/Agenta-AI/agenta/pull/5857) strip derivation trusts local
  settles; [#5913](https://github.com/Agenta-AI/agenta/pull/5913) extends "awaiting" to a
  pending interaction anywhere in the tab's transcript.
- [#5859](https://github.com/Agenta-AI/agenta/pull/5859) replay renders parked client
  tools at all (the render-hint mechanism).
- [#5909](https://github.com/Agenta-AI/agenta/pull/5909) connect flow: correct auth
  scheme, visible errors, decline reaches the server, adoption guarded against clobbering
  a just-settled answer.
- [#5912](https://github.com/Agenta-AI/agenta/pull/5912) replay renders server-cancelled
  interactions inert instead of resurrecting them.
- [#5910](https://github.com/Agenta-AI/agenta/pull/5910) runner: an answered approval's
  result is observed before a carried sibling re-parks the turn.
- Issues: [#5907](https://github.com/Agenta-AI/agenta/issues/5907) (ordering race),
  [#5911](https://github.com/Agenta-AI/agenta/issues/5911) (connection reuse).
