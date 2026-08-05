# Research

## Existing title ownership

- The OSS application writes a static marketing title in `web/oss/src/components/Scripts/GlobalScripts.tsx`.
- EE reuses the same synchronous `GlobalScripts` fallback; the asynchronous `CloudScripts` component must not write a competing title.
- The implementation must keep one safe fallback while allowing page-level `next/head` titles to override it.

## Routing and rendering facts

- Home normally uses the `/apps` route.
- First-run onboarding can render Home through `/playground`, so pathname alone cannot identify Home correctly.
- Project observability and agent traces reuse the observability feature. The feature must choose project or agent context from the state already available to it.
- Settings uses one route with a tab query parameter. Changing tabs must not change the browser title.

## Dynamic chat facts

- Agent chat sessions are scoped and expose an active session.
- `web/oss/src/components/AgentChatSlice/state/sessions.ts` persists a session title from the first user message and caps it at 60 characters.
- The agent display name belongs to the workflow artifact, not to a revision.
- The playground already has the artifact and active session state needed for the title. No additional fetch is required.

## Design decision

Use a small declarative `PageTitle` component and formatter built on `next/head`. Each page-level feature supplies its semantic title. The agent playground owns the choice between the artifact name for an empty session and the active session title after chat starts. The observability feature owns the choice between project and agent context.

This avoids a global pathname switch that would duplicate route knowledge and miss render-state exceptions such as onboarding. The formatter owns whitespace normalization, the `|` separator, the `Agenta` fallback, and the 60-character limit. Feature code owns meaning.

## Risks and safeguards

- Multiple `<title>` elements could compete. Use the existing Next.js head mechanism consistently and retain only one global fallback.
- Loading state could expose an ID. Keep `Agenta` until a semantic name is available.
- A stale chat title could survive a session switch. Derive it reactively from the active scoped session.
- Agent rename could leave the title stale. Read the artifact name from reactive workflow state.
- Route-only logic could label onboarding as Playground. Let the rendered Home feature supply `Home`.

