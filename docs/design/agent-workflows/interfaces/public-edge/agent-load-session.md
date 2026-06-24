# Agent Load Session

`POST {agent route}/load-session` is the contract a client calls to resume an earlier
conversation from the server. The route exists and validates input, but it is not wired to
durable storage yet. Knowing that gap is the point of this page: a reviewer should not
assume server-side history works.

## The contract

```jsonc
// request
{ "session_id": "sess_abc" }

// response
{ "session_id": "sess_abc", "messages": [ /* Vercel UIMessage[] */ ] }
```

The default store is `NoopSessionStore`, and its `load()` returns an empty list. So today
the response always carries `messages: []`. The browser owns conversation state through
`useChat`; nothing server-side rehydrates it. The `session_id` is validated against the
same `^[A-Za-z0-9._:-]{1,128}$` rule as `/messages`, and an invalid id returns `400`.

The contract is shaped for the day a real `SessionStore` lands. Until then, treat a
non-empty response as a signal that durable history has been wired, and check the rest of
the resume path with it.

## Owned by

- `sdks/python/agenta/sdk/agents/adapters/vercel/routing.py`: the route and validation.
- `sdks/python/agenta/sdk/agents/interfaces.py`: the `SessionStore` port and the no-op default.

## Watch for when changing

- **Wiring a real store.** The first non-no-op `SessionStore` makes this contract live.
  Confirm the conversation rehydrates and that resumed turns carry their tool and approval
  state, not just text.
- **Session id validation.** Keep it identical to `/messages`. The two routes share the id.
- **Server-owned resume.** Decide what the server is allowed to return for a session that
  belongs to another project or user before history becomes real.
