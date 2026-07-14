# Agent chat — Elicitation E2E (interaction kinds M1, layer A)

Deterministic Playwright coverage for the `elicitation` interaction kind: emit → render → settle →
resume → replay, driven by a **transport mock** rather than a live LLM.

## How it works

Auth, the ephemeral project, the seeded agent revision, and the playground shell stay **real**. Only
the agent run (`**/invoke*`) is intercepted (`mockElicitationInvoke` in `tests.ts`) and fulfilled with
byte-accurate AI SDK v6 SSE (`assets/elicitationStream.ts`):

- **1st run** → a paused turn: `request_input` left `input-available` (no output) + the sibling
  `data-render` part (`{kind: "elicitation"}`) → the FE renders the form.
- **2nd run** (the auto-resume after the form settles) → a normal text turn echoing the values.

The SSE shapes are pinned against the real producer,
`sdks/python/agenta/sdk/agents/adapters/vercel/{stream,sse}.py`. The mocked response **must** set
`Content-Type: text/event-stream` or the FE's negotiating fetch parses it as batch JSON.

## Specs (`index.ts`)

1. **Round-trip** — form renders, accept resumes with the submitted values (asserts the resume POST
   carried the settled output). Mock-only, no reload.
2. **Required-field gate** — empty Accept shows an inline error and does not resume. Mock-only.
3. **Settled replay** — after accept, a reload shows the read-only chip.
4. **Reload-while-pending** — reload with the form pending, then accept.

## First-run seams (resolve against the live stack — do NOT assume)

These are isolated on purpose; the SSE/transport core above is solid, these need one live pass:

- **`seedAgentChatApp` (`tests.ts`) — the one hard blocker.** The playground mounts `AgentChatPanel`
  only for an `is_agent` workflow (`Playground.tsx:106`); the base fixture only seeds
  completion/chat. Since `/invoke` is mocked, the agent's config is irrelevant — a **minimal rendered
  `is_agent` revision** is all that's needed. Seed it by replaying the product's create-agent API
  calls (mirror `apiHelpers.createApp`) or by driving the create flow once and capturing the appId +
  latest revision id. The fixture currently throws until this is done.
- **Composer + field selectors** — `sendChatMessage` and `getByLabel("First Name")` are best-effort
  against `RichChatInput` and the `SchemaForm` DOM; confirm and adjust on first run.
- **Reload rehydration source (specs 3 & 4)** — a mocked run records no server-side session
  transcript. If reload rehydrates the chat from client persistence these pass as-is; if it loads from
  the server transcript, the mock must also serve the session-history endpoint. Confirm first.

## Run one spec (from `web/tests/`, with the stack up)

```bash
AGENTA_LICENSE=oss \
AGENTA_WEB_URL="http://localhost:3000" \
AGENTA_API_URL="http://localhost:3000/api" \
AGENTA_TEST_LLM_PROVIDER=mock \
npx playwright test ../oss/tests/playwright/acceptance/agent-chat/elicitation.spec.ts \
  --workers=1 --retries=0 --headed
```

Start with spec 1 (round-trip) — it needs no reload and proves the transport-mock pattern end to end.
