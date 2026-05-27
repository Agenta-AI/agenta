# Research: Opening Spans in the Playground

## Question

A user clicks the "Playground" button on a trace span. What decides whether the playground opens the existing application revision, a fresh disposable workflow, in the full page, or in a stacked drawer? And why does a span whose references only carry slugs (no UUIDs) fail to link back to the original application?

## High level

### What the user sees

The trace drawer has a "Playground" button in its header. The button is enabled for spans the user can realistically replay, and disabled with a tooltip otherwise. Once enabled, clicking it leads to one of four outcomes.

The four outcomes are the product of two independent decisions:

1. **Which entity to load**: an existing application revision (with edit + commit semantics), or a fresh ephemeral workflow created in the browser (with create-new semantics).
2. **Where to load it**: full-page playground inside the parent application, or a drawer stacked on top of the trace drawer.

| Loaded entity \ Location | Full page (inside an app) | Stacked drawer |
|---|---|---|
| Existing revision | Edit the app's actual revision, commit publishes a new revision | Edit an evaluator revision in place |
| Ephemeral workflow | Disposable workflow opens inside the parent app's playground | Disposable workflow with no parent |

The user's mental model is simple: "send this span to the playground so I can tweak and rerun it." The complexity sits in the decision tree above, and the decision is driven entirely by what the span carries in its `references`.

### What counts as a "reference"

A span can carry up to six structured pointers, each with an `id`, a `slug`, and a `version`:

- `application`, `application_variant`, `application_revision`
- `evaluator`, `evaluator_variant`, `evaluator_revision`

The frontend cares about two pieces of information from these references:

- The **application id (UUID)** decides whether to open the playground full-page inside an existing app.
- The **revision id (UUID)** (for `application_revision` or `evaluator_revision`) decides whether to open the user's actual stored revision rather than a disposable copy.

Slugs and version numbers are present for display but the frontend does not use them to resolve entities. There is no client-side lookup from `slug` to `id`.

### Why some spans don't open in the linked app

When a span's `application` reference carries a `slug` but no `id`, the frontend has no way to build the URL `/apps/{appId}/playground`, so it falls back to the stacked drawer. When the `application_revision` reference carries a `version` (a sequence number like `"1"`) but no `id`, the frontend cannot fetch the specific revision and falls back to creating a disposable copy seeded from the span's captured inputs and parameters.

So a span with `{application: {slug: "n8n"}, application_revision: {version: "1"}}` still opens the playground, but it opens an orphan ephemeral entity in a drawer, not the n8n app's revision in its proper page. The user perceives this as "it didn't link to my app."

The fix is upstream: spans need to carry UUIDs on their references, not just slugs and version numbers. The frontend is behaving correctly given what it sees.

### Where the slug-only references come from

Spans produced by third-party instrumentation (LangChain, langfuse-style adapters, n8n integrations) typically know the application by slug because the slug is what the user types. They do not have the Agenta UUIDs unless something resolves the slugs to ids and stamps them onto the references.

Three places could do that resolution:

1. **The SDK exporter**, before the span leaves the user's process.
2. **The API ingest pipeline**, when the span is written to storage.
3. **The frontend**, lazily when the user clicks the button.

The frontend option is the worst, since every click would do an API round-trip. The other two are open design questions.

---

## Technical

### Entry point and enable logic

The "Playground" button lives in `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/TraceTypeHeader/index.tsx`.

The enable computation is `openInPlaygroundState` at `TraceTypeHeader/index.tsx:84-143`. It uses two helpers:

- `hasAppReference(span)` at lines 48-63: returns true if `ag.references.application` OR `ag.references.application_revision` exists (also checks the top-level array form). It does not require an `id` field; the *existence* of the reference object is enough.
- `INVOCATION_SPAN_TYPES = {"workflow", "task", "agent", "chain"}` at line 42.

The enable rules:

- Invocation spans → enabled if `hasAppReference || hasExtractableData` (`agData.inputs || agData.parameters`).
- `chat` spans → enabled if `hasExtractableData`.
- Everything else → disabled with a per-case tooltip.

### Click handler and drawer-vs-page split

The click handler is `handleOpenInPlayground` at `TraceTypeHeader/index.tsx:147-198`. It calls `setOpenInPlayground(activeTrace)` (which dispatches the `openTraceInPlaygroundAtom`, i.e., `openFromTraceAtom`) and then branches on the returned `result`:

```ts
if (result.appId) {
    // FULL PAGE: close trace drawer, navigate to /apps/{appId}/playground
} else {
    // DRAWER: openWorkflowRevisionDrawer with expanded: true, stacked: true
}
```

This is the only place where the drawer-vs-page choice is made. It is binary on `result.appId`.

### Reference extraction

`extractReferences` is at `web/packages/agenta-playground/src/state/controllers/playgroundController.ts:1068-1106`. It reads `ag.references` (dict form) first, then merges in any keys from the top-level `references` array (array-of-objects form). Each entry is a `{id?, slug?, version?}` triple. The function preserves whichever fields are present and does not synthesize `id` from `slug`.

### Decision logic

The full decision lives in `openFromTraceAtom` at `playgroundController.ts:1136-1646`. For invocation spans the path is:

1. Lines 1140-1170: extract `ag.data`, references, evaluator flag, and a display `label`.
2. Lines 1183-1287: extract inputs, outputs, parameters; handle nested input shapes; walk descendants if parameters are empty; promote `PromptTemplate`-shaped inputs into parameters.
3. Lines 1294-1323: **revision branch**. `const revisionId = asString(refs.application_revision?.id)`. If `revisionId` is truthy, call `addPrimaryNodeAtom` with that id and return `{type: "revision", entityId: revisionId, label, inputs, appId: applicationId}`. The `appId` carries through so the click handler navigates to the full page.
4. Lines 1332-1364: **evaluator revision branch** (mirrors the above for evaluator spans).
5. Lines 1366-1420: **ephemeral fallback**. `createEphemeralWorkflow({label, inputs, outputs, parameters, sourceRef, ...})`. The `sourceRef` is built at lines 1369-1375 and is `undefined` when `applicationId` is missing. Returns `{type: "ephemeral", entityId, appId: applicationId}`.

The chat-span branch at lines 1423-1572 always creates ephemeral and never tries to resolve an existing revision.

Key observation: every gate is `asString(refs.<thing>?.id)`. There is no slug-based lookup, no UUID-format validation either (so a bare version `"1"` shows up as truthy if it ever lands in the `id` field by accident; in the cases we have seen, it lands in `version`, leaving `id` undefined).

### Where `appId` is finalized

For the revision branch, `applicationId` comes from line 1154: `const applicationId = asString(refs.application?.id)`. For the ephemeral branch, the return at line 1402 (approx) uses the same variable. If `refs.application` only carries `slug`, `applicationId` is `null` and `result.appId` is `undefined`.

### Drawer rendering

When `result.appId` is missing, the click handler dispatches `openWorkflowRevisionDrawerAtom` (`TraceTypeHeader/index.tsx:185-190`) with `context: "variant"`, `expanded: true`, `stacked: true`. The drawer wrapper at `web/oss/src/components/WorkflowRevisionDrawerWrapper/index.tsx:138-406` then mounts either `DrawerAppPlayground` (mode `"app"`) or `DrawerEvaluatorPlayground` (mode `"evaluator"`) based on the entity's flags.

### Concrete trace example (from the user)

The n8n RAG span carries:

```json
"references": {
  "application":          { "slug": "n8n" },
  "application_variant":  {},
  "application_revision": { "version": "1" }
}
```

Walk through the code:

1. `hasAppReference` returns `true` (the `application` key exists).
2. The button is enabled.
3. In `openFromTraceAtom`: `revisionId = asString(refs.application_revision?.id)` → `null` (no `id` field).
4. Revision branch skipped.
5. Ephemeral fallback runs. `applicationId = asString(refs.application?.id)` → `null`.
6. `sourceRef` is `undefined` (no application id to build the link).
7. `result = {type: "ephemeral", entityId: <new>, appId: undefined}`.
8. Click handler sees no `appId` → opens the workflow revision drawer in stacked mode.

What the user gets: a disposable playground in a drawer, unlinked from the n8n app, seeded from the span's captured inputs. What the user expected: the n8n app's revision in its full-page playground.

### Related fragile spots

These came up during the walkthrough and are worth noting even if they are not the immediate bug:

- The `extractReferences` function reads the dict form first and the array form second, with first-match-wins. Conflicting references in both forms would silently mask one.
- Nested-vs-flat input handling is duplicated between the invocation branch (lines 1202-1210) and the chat branch (lines 1576-1579). Easy to fix one and miss the other.
- The `looksLikePromptConfig` shape check (around line 891-897) could false-positive on user dicts that happen to contain a `messages` array plus an `llm_config` key.
- The descendant-parameter walk (`findDescendantParameters`, lines 911-935) is depth-first with no cycle guard. Fine in practice; worth knowing.

### Files involved

| File | Role |
|---|---|
| `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/TraceTypeHeader/index.tsx` | Button enable state, click handler, drawer-vs-page branch |
| `web/packages/agenta-playground/src/state/controllers/playgroundController.ts` | `openFromTraceAtom`, `extractReferences`, all decision logic |
| `web/oss/src/components/WorkflowRevisionDrawerWrapper/index.tsx` | Stacked drawer rendering |
| `web/packages/agenta-entities/src/trace/...` | `extractInputs`, `extractOutputs` (called from the controller) |

### Open questions for the design

1. Where should slug → UUID resolution happen: SDK exporter, API ingest, or frontend lazy?
2. Should the API enrich `ag.references` at ingest time so the frontend stays simple? This was already considered for related work (see `docs/design/best-effort-ingestion/`).
3. For partial references (e.g., application id present, revision id missing): should the playground auto-pick the latest revision of the app, or stay ephemeral?
4. If we go with frontend lazy resolution as a stopgap, how do we avoid blocking the click on an API round-trip?
