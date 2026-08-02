import {
    workflowSchema,
    workflowVariantsResponseSchema,
    type Workflow,
    type WorkflowListRef,
} from "@agenta/entities/workflow"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../.storybook/decorators/withAgentaData"

/**
 * Fixture builders for the EntityPicker (selection) stories.
 *
 * The pickers are seeded through the workflow adapter (Workflow → Variant → Revision)
 * because every query it reads honors the story client's `refetchOnMount: false` default.
 * The testset adapter's root list (`testsetsListQueryAtomFamily`,
 * `testset/state/store.ts:643`) sets `refetchOnMount: "always"`, which fires the real
 * `queryFn` even over seeded data — in Storybook that fetch fails and flips the list
 * atom to `isError`, so the testset adapter cannot be seeded via the data seam.
 *
 * Same contract as `workflow.ts`: payloads with an API-boundary zod schema go through it
 * (`workflowSchema`, `workflowVariantsResponseSchema`). The thin-ref list shapes
 * (`WorkflowListRef` / `WorkflowRevisionRef`) are derived post-fetch inside the query
 * atoms, not API responses, so they are seeded raw but typed. Ids come from the story's
 * `StoryScope` (L1 isolation).
 */

const TIMESTAMPS = {created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"}

export interface EntityPickerIds {
    projectId: string
    /** "Support Agent" — the workflow with variants + revisions seeded. */
    supportId: string
    /** "Chat Assistant" (is_chat — renders the type tag) and "Docs Summarizer". */
    chatId: string
    docsId: string
    prodVariantId: string
    stagingVariantId: string
    /** Revisions of the Production variant, newest first (v3, v2, v1). */
    revisionIds: [string, string, string]
}

export function entityPickerIds(scope: StoryScope): EntityPickerIds {
    return {
        projectId: scope.projectId,
        supportId: scope.id("wf-support"),
        chatId: scope.id("wf-chat"),
        docsId: scope.id("wf-docs"),
        prodVariantId: scope.id("var-prod"),
        stagingVariantId: scope.id("var-staging"),
        revisionIds: [scope.id("rev-v3"), scope.id("rev-v2"), scope.id("rev-v1")],
    }
}

/** Mirror of `toWorkflowListRef` (workflow/state/store.ts:392) — not exported from the barrel. */
function workflowRef(
    id: string,
    name: string,
    slug: string,
    flags: Record<string, boolean>,
): WorkflowListRef {
    // Parse through the schema first so a flag typo fails loudly here.
    const w = workflowSchema.parse({id, name, slug, flags, ...TIMESTAMPS})
    return {
        id: String(w.id),
        name: w.name ?? null,
        slug: w.slug ?? null,
        description: null,
        flags: w.flags,
        deleted_at: null,
        created_at: TIMESTAMPS.created_at,
        updated_at: TIMESTAMPS.updated_at,
    }
}

/** A full revision of the Production variant, served from the per-revision detail cache. */
function pickerRevision(
    ids: EntityPickerIds,
    revisionId: string,
    version: number,
    message: string,
    createdAt: string,
): Workflow {
    return workflowSchema.parse({
        id: revisionId,
        slug: `support-agent-v${version}`,
        // Revision `name` carries the VARIANT name; the display name lives on the artifact.
        name: "Production",
        version,
        message,
        workflow_id: ids.supportId,
        workflow_variant_id: ids.prodVariantId,
        flags: {is_agent: true, is_application: true},
        created_at: createdAt,
        updated_at: createdAt,
    })
}

/**
 * Every query key the workflow selection adapters transitively read. Keys are copied from
 * the atoms that own them — that coupling is the honest cost of cache-level seeding:
 */
export function entityPickerQueries(scope: StoryScope): [QueryKey, unknown][] {
    const ids = entityPickerIds(scope)
    const {projectId, supportId, chatId, docsId, prodVariantId, stagingVariantId, revisionIds} = ids

    const revisions = [
        pickerRevision(ids, revisionIds[0], 3, "Tighten the system prompt", "2026-01-03T00:00:00Z"),
        pickerRevision(ids, revisionIds[1], 2, "Add escalation tool", "2026-01-02T00:00:00Z"),
        pickerRevision(ids, revisionIds[2], 1, "Initial commit", "2026-01-01T00:00:00Z"),
    ]
    // Thin refs (WorkflowRevisionRef) — the shape the revisions queries cache.
    const revisionRefs = revisions.map((r) => ({
        id: String(r.id),
        version: r.version ?? null,
        created_at: r.created_at ?? null,
    }))

    const emptyRefs = {count: 0, refs: []}

    return [
        // appWorkflowsListQueryAtom             → workflow/state/store.ts:414
        //   root level of workflowsListQueryStateAtom (allWorkflows.ts:63)
        [
            ["workflows", "apps", "list", projectId],
            {
                count: 3,
                refs: [
                    workflowRef(supportId, "Support Agent", "support-agent", {
                        is_agent: true,
                        is_application: true,
                    }),
                    workflowRef(chatId, "Chat Assistant", "chat-assistant", {
                        is_chat: true,
                        is_application: true,
                    }),
                    workflowRef(docsId, "Docs Summarizer", "docs-summarizer", {
                        is_custom: true,
                        is_application: true,
                    }),
                ],
            },
        ],
        // evaluatorsListQueryAtom               → workflow/state/evaluatorUtils.ts:81
        //   the other half of the workflows union — empty keeps the list app-only
        [["workflows", "evaluators", "list", projectId], emptyRefs],
        // workflowVariantsScopedQueryAtomFamily → workflow/state/store.ts:543
        //   middle level (workflowToVariantRelation)
        [
            ["workflows", "variants", supportId, projectId],
            workflowVariantsResponseSchema.parse({
                count: 2,
                workflow_variants: [
                    {
                        id: prodVariantId,
                        name: "Production",
                        slug: "production",
                        workflow_id: supportId,
                        ...TIMESTAMPS,
                    },
                    {
                        id: stagingVariantId,
                        name: "Staging",
                        slug: "staging",
                        workflow_id: supportId,
                        ...TIMESTAMPS,
                    },
                ],
            }),
        ],
        [
            ["workflows", "variants", chatId, projectId],
            workflowVariantsResponseSchema.parse({count: 0, workflow_variants: []}),
        ],
        [
            ["workflows", "variants", docsId, projectId],
            workflowVariantsResponseSchema.parse({count: 0, workflow_variants: []}),
        ],
        // workflowRevisionsQueryAtomFamily      → workflow/state/store.ts:744
        //   leaf level (workflowVariantToRevisionRelation) — thin refs by variant
        [["workflows", "revisions", prodVariantId, projectId], {count: 3, refs: revisionRefs}],
        [["workflows", "revisions", stagingVariantId, projectId], emptyRefs],
        // workflowRevisionsByWorkflowQueryAtomFamily → workflow/state/store.ts:636
        //   the 2-level (skip-variant) relation used by the list-popover story
        [
            ["workflows", "revisionsByWorkflow", supportId, projectId],
            {count: 3, refs: revisionRefs},
        ],
        [["workflows", "revisionsByWorkflow", chatId, projectId], emptyRefs],
        [["workflows", "revisionsByWorkflow", docsId, projectId], emptyRefs],
        // workflowQueryAtomFamily               → workflow/state/store.ts:1187
        //   per-revision detail cache the thin refs resolve through (workflowBaseEntityAtomFamily)
        ...revisions.map((r): [QueryKey, unknown] => [
            ["workflows", "revision", String(r.id), projectId],
            r,
        ]),
    ]
}
