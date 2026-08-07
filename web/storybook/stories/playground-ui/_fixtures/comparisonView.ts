/**
 * Query + atom fixtures for the comparison-view components: two completion-mode revisions of
 * one workflow, seen side by side.
 *
 * Found by the console loop, not by reading the molecule: render, read
 * `[withAgentaData] no fixture for queryKey`, add the key, repeat. See
 * `LoadModeContent.stories.tsx` for the full write-up.
 */
import type {PlaygroundNode} from "@agenta/entities/runnable"

type QueryFixture = [unknown[], unknown]

export const WORKFLOW_ID = "wf-classify-cv"
export const VARIANT_A_ID = "variant-a-cv"
export const VARIANT_B_ID = "variant-b-cv"
export const REVISION_A_ID = "rev-classify-a-cv"
export const REVISION_B_ID = "rev-classify-b-cv"

/** Completion-mode revision — `flags.is_chat: false` is what makes `isChatMode` resolve. */
export const revisionA = {
    id: REVISION_A_ID,
    workflow_id: WORKFLOW_ID,
    workflow_variant_id: VARIANT_A_ID,
    slug: "classify-a",
    name: "default",
    version: 3,
    message: "Add refund intent and relabel the spam bucket.",
    flags: {is_chat: false},
    created_at: "2026-07-14T16:30:00Z",
    created_by_id: "user-ashraf",
}

export const revisionB = {
    id: REVISION_B_ID,
    workflow_id: WORKFLOW_ID,
    workflow_variant_id: VARIANT_B_ID,
    slug: "classify-b",
    name: "default",
    version: 1,
    message: "Baseline classifier.",
    flags: {is_chat: false},
    created_at: "2026-07-10T09:00:00Z",
    created_by_id: "user-ashraf",
}

/**
 * `workflowMolecule.selectors.variantLabel(entityId)` (used by `GenerationComparisonOutputHeader`)
 * reads the VARIANT's name/slug, never the revision's — see the "Entity display names" rule in
 * `web/AGENTS.md`. It resolves through `["workflows", "variants", workflowId, projectId]`, which
 * is itself gated on `sessionAtom` at the outer selector (`workflowVariantsQueryAtomFamily`
 * short-circuits to `data: undefined` before even reading the cache when session is closed) — so
 * stories that need a resolved variant label must run with `session: true`, not the usual
 * `session: false`.
 */
export const variantsResponse = {
    count: 2,
    workflow_variants: [
        {id: VARIANT_A_ID, slug: "gpt-4o", name: "GPT-4o", workflow_id: WORKFLOW_ID},
        {id: VARIANT_B_ID, slug: "gpt-4o-mini", name: "GPT-4o mini", workflow_id: WORKFLOW_ID},
    ],
}

/**
 * A revision with no `workflow_variant_id`/`variant_id` at all — `variantLabelAtomFamily`
 * short-circuits to `null` before ever reading the variants list, so the header falls back to
 * `data?.name` ("default", the revision's own dead-for-display name field — see
 * `web/AGENTS.md`'s "Entity display names" rule). Not a local draft, so this is the fallback
 * firing for a reason OTHER than the one its own comment describes.
 */
export const REVISION_NO_VARIANT_ID = "rev-no-variant-cv"
export const revisionNoVariant = {
    id: REVISION_NO_VARIANT_ID,
    workflow_id: WORKFLOW_ID,
    slug: "classify-orphan",
    name: "default",
    version: 2,
    message: "Revision with no variant link.",
    flags: {is_chat: false},
    created_at: "2026-07-12T12:00:00Z",
    created_by_id: "user-ashraf",
}

/** Local-draft id — `isLocalDraftId` matches the `local-` prefix, so the badge reads "Draft". */
export const REVISION_DRAFT_ID = "local-classify-draft-cv"
export const revisionDraft = {
    id: REVISION_DRAFT_ID,
    workflow_id: WORKFLOW_ID,
    slug: "classify-draft",
    name: "Untitled draft",
    version: 0,
    flags: {is_chat: false},
}

export const comparisonQueries = (projectId: string): QueryFixture[] => [
    [["workflows", "revision", REVISION_A_ID, projectId], revisionA],
    [["workflows", "revision", REVISION_B_ID, projectId], revisionB],
    [["workflows", "revision", REVISION_NO_VARIANT_ID, projectId], revisionNoVariant],
    [["workflows", "revision", REVISION_DRAFT_ID, projectId], revisionDraft],
    [
        ["workflows", "detail", projectId, WORKFLOW_ID],
        {id: WORKFLOW_ID, slug: "classify", name: "Classify"},
    ],
    [["workflows", "variants", WORKFLOW_ID, projectId], variantsResponse],
]

/**
 * `playgroundNodesAtom` (`@agenta/playground/state`) is a non-family singleton primitive atom —
 * it leaks across stories in the shared Jotai store (see `withAgentaData.tsx`'s isolation
 * doc). Every story that seeds it must also list it in `parameters.agenta.reset` so it starts
 * from a known value regardless of story order.
 */
export const twoVariantNodes: PlaygroundNode[] = [
    {id: "node-a", entityId: REVISION_A_ID, depth: 0, label: "classify", entityType: "workflow"},
    {id: "node-b", entityId: REVISION_B_ID, depth: 0, label: "classify", entityType: "workflow"},
]
