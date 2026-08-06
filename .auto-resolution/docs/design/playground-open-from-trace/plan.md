# Plan: Resolve slug-only references when opening a trace in the playground

## Goal

When a user clicks "Playground" on a trace span whose references carry slugs but no UUIDs, resolve the slugs to UUIDs at click time and open the playground exactly as we would for a span that had UUIDs all along.

This fixes the case where third-party integrations (n8n, LangChain-style adapters, anything that knows the app by slug but not by id) produce spans the playground cannot currently link back to their app.

## Decisions

Captured from the research and review:

1. Resolution happens **at click time** in the frontend. No producer or backend changes.
2. The resolver lives **inside `openFromTraceAtom`** so all current and future callers benefit.
3. We use the existing **`POST /workflows/revisions/retrieve`** endpoint. One round trip, returns both `id` (revision UUID) and `workflow_id` (app UUID).
4. **Spinner on the Playground button** during resolution. The drawer-to-page transition is not slow enough on its own to cover the wait.
5. **Environment references are ignored** in this PR. If `application.slug` is set, we resolve that. We do not use `environment.slug` to pin a specific deployed revision; that is a follow-up.
6. **No span enrichment**. Resolved ids land in playground state only, not back on the span object in the trace drawer.
7. **Session cache** in front of the helper, keyed by `(projectId, slug, version | "latest")`. Survives navigation, dies on full reload.

## Decision tree (new behavior of `openFromTraceAtom`)

For invocation spans:

```
1. If references.application_revision.id is a UUID
       → existing path: open that revision directly.

2. Else if (evaluator span) references.evaluator_revision.id is a UUID
       → existing path: open that evaluator revision directly.

3. Else if references.application.slug is set:
       version = references.application_revision.version  // may be undefined
       revision = await retrieveWorkflowRevision({
           projectId,
           workflowRef: {slug: application.slug},
           workflowRevisionRef: version ? {version} : undefined,
       })
       if revision:
           // synthesize ids onto a local copy of the refs, then fall through
           refs.application.id          = revision.workflow_id
           refs.application_revision.id = revision.id
           → continue with the existing revision branch.

4. Else
       → existing ephemeral fallback (drawer).
```

If the resolver call fails or returns `null`, log one warning line (with slug + version for diagnostics) and fall through to the ephemeral fallback. The user never sees an error; the worst case is identical to today.

## Behavior matrix

| Span carries | Today | After |
|---|---|---|
| `application.id` + `application_revision.id` | Full-page in the app, real revision | Same |
| `application.slug` + `application_revision.version` | Stacked drawer, orphan ephemeral | Full-page in the app, real revision |
| `application.slug` only (no version, no env) | Stacked drawer, orphan ephemeral | Full-page in the app, **latest** revision |
| `application.slug` + `environment.slug` (no version) | Stacked drawer, orphan ephemeral | Full-page in the app, **latest** revision (environment ignored for now) |
| Slug doesn't exist in this project | Stacked drawer, orphan ephemeral | Same (silent fallback) |
| Slug + bogus version | Stacked drawer, orphan ephemeral | Same (silent fallback) |

## Implementation steps

### Step 1: Add the API helper

**File:** `web/packages/agenta-entities/src/workflow/api/api.ts`

Add a function next to `queryWorkflowRevisions`. Follow the same pattern (axios POST, project id as query param, `safeParseWithLogging` on the response). The `workflowRevisionResponseSchema` is already defined at `web/packages/agenta-entities/src/workflow/core/schema.ts:443`.

Signature:

```ts
export async function retrieveWorkflowRevision({
    projectId,
    workflowRef,
    workflowRevisionRef,
}: {
    projectId: string
    workflowRef: {id?: string; slug?: string; version?: string}
    workflowRevisionRef?: {id?: string; slug?: string; version?: string}
}): Promise<WorkflowRevision | null>
```

Endpoint: `POST /workflows/revisions/retrieve?project_id={projectId}` with body `{workflow_ref, workflow_revision_ref?}`. Return `validated.workflow_revision ?? null`.

Export from `web/packages/agenta-entities/src/workflow/api/index.ts` alongside the other query helpers.

### Step 2: Build the resolver

**File:** `web/packages/agenta-playground/src/state/controllers/playgroundController.ts`

Add a private helper near `extractReferences`. It takes the extracted refs object and a `projectId`, returns a resolved `WorkflowRevision | null`.

Behavior:

- If `application.slug` is not set, return `null` immediately (no resolution needed).
- Build the cache key: `${projectId}:${slug}:${version ?? "latest"}`.
- If the key is in the module-level cache, return the cached revision.
- Otherwise call `retrieveWorkflowRevision`, store the result (including `null`) in the cache, and return it.

The cache is a `Map<string, WorkflowRevision | null>` declared at module scope. No invalidation; it lives until the next full page reload. Acceptable for this UX surface because slugs are stable per session.

### Step 3: Wire into `openFromTraceAtom`

Same file. Make the atom's setter `async`. Add the slug-resolution branch as described in the decision tree.

The branch synthesizes ids onto a local copy of the refs object and then falls through to the existing revision branch (step 1294-1323 today). The existing branch does not change. This keeps the diff small and the regression surface tight.

### Step 4: Update the click handler

**File:** `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/TraceTypeHeader/index.tsx`

- Mark `handleOpenInPlayground` async. Await the now-async `setOpenInPlayground(activeTrace)`.
- Add a `loading` state local to the component. Set it before the await, clear it in a `finally`.
- Pass `loading={loading}` to the Playground button (Ant Design `Button` supports this directly).

The rest of the handler is unchanged: it still branches on `result.appId` for full-page vs. drawer.

### Step 5: Verification

Manual checks:

1. **Happy path (slug + version):** open the n8n trace, click Playground. Verify the button shows a spinner briefly, then the n8n app's playground opens full-page with the actual revision selected. Confirm the action panel shows **Commit** (real revision), not **Create** (orphan ephemeral).
2. **Slug only, no version:** find or fake a span with `{application: {slug: "..."}}` and no revision. Verify it opens the latest revision of that app full-page.
3. **Slug + environment (no version):** verify it opens the latest revision; environment ref is ignored without error.
4. **Slug does not exist:** modify a span to carry a bogus slug. Verify the drawer fallback still opens and no error toast appears.
5. **Slug + bogus version:** verify the drawer fallback still opens.
6. **Pre-existing UUID path:** open a span that already has `application_revision.id`. Verify no extra network request fires (DevTools network tab), and the path is unchanged.
7. **Cache:** open two spans from the same `(slug, version)` pair in sequence. Verify only the first triggers a network call.
8. **Lint:** `pnpm lint-fix` clean in `web/`.

## Out of scope (tracked as later issues)

- **Issue 2:** What to do when the revision actually does not exist anymore (e.g., archived). Today we open ephemeral; we may want to be smarter.
- **Issue 3:** Reviewing how span data maps into the playground (parameters, inputs, prompt promotion). When a slug + no version resolves to latest, we may want to also seed parameters from the span. Out of scope here.
- **Environment-based resolution:** if `application.slug + environment.slug` should open the deployed revision rather than the latest, that needs a second endpoint call or a different shape on `/workflows/revisions/retrieve`. Follow-up.
- **Producer-side or read-side enrichment.** Not needed if this PR works.
- **Span object enrichment in the trace drawer.** Confirmed out of scope.

## Risk

Low. The change is additive:

- New API helper, no existing helper changes.
- New branch in `openFromTraceAtom`, gated on a precondition (slug without id) that no existing code handles.
- Click handler becomes async, but the failure mode is identical to today.

The `openFromTraceAtom` becoming async is the only signature change. There is currently one caller (`TraceTypeHeader`), so the blast radius is one file.

## Open questions

None at plan time. Will revisit during implementation if anything surfaces.
