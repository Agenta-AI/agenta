import {environmentsResponseSchema, type EnvironmentsResponse} from "@agenta/entities/environment"
import {
    workflowSchema,
    workflowVariantsResponseSchema,
    type Workflow,
    type WorkflowVariantsResponse,
} from "@agenta/entities/workflow"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../.storybook/decorators/withAgentaData"

/**
 * Fixture builders for the workflow/environment queries.
 *
 * Every builder runs its payload through the SAME zod schema the API boundary validates
 * with (`safeParseWithLogging(workflowSchema, …)`), so a fixture cannot drift from the
 * contract without failing loudly here first. That is the whole reason fixtures live
 * next to the schemas rather than being hand-typed object literals.
 *
 * Ids come from the story's `StoryScope`, never from a shared constant — that is the L1
 * isolation rule. Two stories addressing the same `atomFamily(id)` entry is the only way
 * draft/dirty state can leak between them, and scoped ids make it impossible.
 */

export interface WorkflowIds {
    projectId: string
    workflowId: string
    variantId: string
    revisionId: string
    latestRevisionId: string
}

export function workflowIds(scope: StoryScope): WorkflowIds {
    return {
        projectId: scope.projectId,
        workflowId: scope.id("wf"),
        variantId: scope.id("var"),
        revisionId: scope.id("rev"),
        latestRevisionId: scope.id("rev-latest"),
    }
}

const TIMESTAMPS = {created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"}

export function workflowRevision(ids: WorkflowIds, overrides: Partial<Workflow> = {}): Workflow {
    return workflowSchema.parse({
        id: ids.revisionId,
        slug: "my-agent-v3",
        name: "My Agent",
        version: 3,
        message: "Tighten the system prompt",
        workflow_id: ids.workflowId,
        workflow_variant_id: ids.variantId,
        flags: {is_agent: true, is_application: true},
        ...TIMESTAMPS,
        ...overrides,
    })
}

export function workflowVariants(
    ids: WorkflowIds,
    names: string[] = ["Production"],
): WorkflowVariantsResponse {
    return workflowVariantsResponseSchema.parse({
        count: names.length,
        workflow_variants: names.map((name, i) => ({
            id: i === 0 ? ids.variantId : `${ids.variantId}-${i}`,
            name,
            slug: name.toLowerCase().replace(/\s+/g, "-"),
            workflow_id: ids.workflowId,
            ...TIMESTAMPS,
        })),
    })
}

/** An environments list in which `revisionId` is deployed to each named environment. */
export function environmentsDeploying(
    revisionId: string,
    envNames: string[] = ["production"],
): EnvironmentsResponse {
    return environmentsResponseSchema.parse({
        count: envNames.length,
        environments: envNames.map((name, i) => ({
            id: `env-${i}`,
            name,
            slug: name,
            // revisionDeploymentAtomFamily walks data.references[app].application_revision.id
            // (environment/state/store.ts:335) — that nesting IS the contract.
            data: {references: {app: {application_revision: {id: revisionId}}}},
            ...TIMESTAMPS,
        })),
    })
}

/**
 * The four query keys `VariantNameCell` transitively reads. Keys are copied from the atoms
 * that own them, which is the honest coupling cost of cache-level seeding — see the story.
 */
export function variantNameCellQueries(
    scope: StoryScope,
    opts?: {
        revision?: (ids: WorkflowIds) => Workflow
        variantNames?: string[]
        isLatest?: boolean
        deployedTo?: string[]
    },
): [QueryKey, unknown][] {
    const ids = workflowIds(scope)
    const revision = opts?.revision ? opts.revision(ids) : workflowRevision(ids)
    const revisionId = String(revision.id)
    const {projectId, workflowId} = ids

    return [
        // workflowQueryAtomFamily               → workflow/state/store.ts:1127
        [["workflows", "revision", revisionId, projectId], revision],
        // workflowVariantsScopedQueryAtomFamily → workflow/state/store.ts:527
        [
            ["workflows", "variants", workflowId, projectId],
            workflowVariants(ids, opts?.variantNames),
        ],
        // workflowLatestRevisionQueryAtomFamily → workflow/state/store.ts:889
        [
            ["workflows", "latestRevision", workflowId, projectId],
            opts?.isLatest === false ? workflowRevision(ids, {id: ids.latestRevisionId}) : revision,
        ],
        // environmentsListQueryAtomFamily(false) → environment/state/store.ts:207
        [
            ["environments-list", projectId, false],
            environmentsDeploying(revisionId, opts?.deployedTo ?? []),
        ],
    ]
}
