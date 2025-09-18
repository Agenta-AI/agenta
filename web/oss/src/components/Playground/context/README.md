Prompts Source (Read-only compatible)

Purpose

- Allow rendering the exact Playground prompt configuration components outside the Playground (e.g., evaluation viewers) without introducing draft state or mutations.
- Keep existing Playground behavior untouched by default.

Design

- `PromptsSourceProvider`: optional provider that supplies a map of prompts by revisionId.
- `usePromptsSource(revisionId)`: unified hook that returns prompts for a revision. It uses the provider’s prompts when present; otherwise it falls back to the live `promptsAtomFamily(revisionId)`.

Why a provider (not new atoms or changing atom families)

- No global state added. The override is scoped to the subtree that needs it.
- Avoids changing `promptsAtomFamily`’s key/args and touching many call sites.
- Keeps immutable parameters immutable. UI reads both shapes via simple accessors (no enhancement step).

Shape accessors

- Components that consume prompts should support both enhanced (editable) and raw (immutable) shapes:
    - Messages: `(prompt.messages?.value ?? prompt.messages) || []`
    - Tools: `(llmConfig?.tools?.value ?? llm_config?.tools) || []`
    - Response format: `(llmConfig?.responseFormat?.value ?? llm_config?.response_format)`
    - Helpers are provided in `promptShape.ts`.

Usage

```tsx
import {PromptsSourceProvider} from "@/oss/components/Playground/context/PromptsSource"
import PlaygroundVariantConfigPrompt from "@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"

// promptsByRevision should be a map: { [revisionId]: promptsArray }
;<PromptsSourceProvider promptsByRevision={promptsByRevision}>
    <PlaygroundVariantConfigPrompt variantId={revisionId} promptId={promptId} viewOnly />
    {/* All nested components read prompts via usePromptsSource */}
</PromptsSourceProvider>
```

Read-only rendering

- Pass `viewOnly` at the top-level prompt config to hide actions and disable controls.
- Actions (add message/tool) are hidden; controls render disabled.
- When raw parameters are provided (no property IDs), components fall back to read-only labels for fields like Response Format.
