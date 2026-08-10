import {testsetSchema, type Testset} from "@agenta/entities/testset"
import {workflowSchema, type Workflow} from "@agenta/entities/workflow"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../.storybook/decorators/withAgentaData"

/**
 * Fixture builders for the entity modal stories (commit / delete / save).
 *
 * Same contract as `workflow.ts`: every payload goes through the zod schema the API
 * boundary already validates with (`workflowSchema`, `testsetSchema`), so a fixture cannot
 * drift from the backend contract without failing loudly here first. Every id comes from
 * the story's `StoryScope` (L1 isolation) — the commit modal's dirty state lives in
 * `workflowDraftAtomFamily(revisionId)`, so a hardcoded revision id would leak draft
 * state between stories.
 */

const TIMESTAMPS = {created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"}

// ---------------------------------------------------------------------------
// Commit modal (variant adapter → workflow molecule)
// ---------------------------------------------------------------------------

export interface CommitModalIds {
    projectId: string
    workflowId: string
    variantId: string
    revisionId: string
}

export function commitModalIds(scope: StoryScope): CommitModalIds {
    return {
        projectId: scope.projectId,
        workflowId: scope.id("wf"),
        variantId: scope.id("var"),
        revisionId: scope.id("rev"),
    }
}

/**
 * Agent config in the flat-root shape `commitDiff/accessors.ts` recognizes
 * (`parameters.{messages, model, tools, temperature}`).
 */
export function agentParameters(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        messages: [{role: "system", content: "You are a helpful support agent."}],
        model: "gpt-4o-mini",
        temperature: 0.2,
        tools: [
            {
                type: "function",
                function: {
                    name: "search_docs",
                    description: "Search the documentation",
                    parameters: {type: "object", properties: {query: {type: "string"}}},
                },
            },
        ],
        ...overrides,
    }
}

/**
 * A draft `parameters` overlay that differs from `agentParameters()` in every section the
 * semantic classifier groups: instructions (message edit), model, params (temperature),
 * and tools (one edited description + one added tool). Feeding this into
 * `workflowDraftAtomFamily(revisionId)` makes the variant adapter's commit context return
 * non-empty `sections`, which is the agent two-pane branch of EntityCommitModal.
 */
export function draftAgentParameters(): Record<string, unknown> {
    return agentParameters({
        messages: [
            {
                role: "system",
                content: "You are a helpful support agent.\nAlways cite the doc you used.",
            },
        ],
        model: "gpt-4o",
        temperature: 0.4,
        tools: [
            {
                type: "function",
                function: {
                    name: "search_docs",
                    description: "Search the documentation index",
                    parameters: {type: "object", properties: {query: {type: "string"}}},
                },
            },
            {
                type: "function",
                function: {
                    name: "escalate_to_human",
                    description: "Hand the conversation to a human agent",
                    parameters: {type: "object", properties: {reason: {type: "string"}}},
                },
            },
        ],
    })
}

/** The committed revision the modal is asked to commit on top of. */
export function commitRevision(ids: CommitModalIds, overrides: Partial<Workflow> = {}): Workflow {
    return workflowSchema.parse({
        id: ids.revisionId,
        slug: "support-agent-v4",
        // Revision `name` carries the VARIANT name; the entity name lives on the artifact.
        name: "default",
        version: 4,
        message: "Tighten the greeting",
        workflow_id: ids.workflowId,
        workflow_variant_id: ids.variantId,
        flags: {is_agent: true, is_application: true},
        data: {parameters: agentParameters()},
        ...TIMESTAMPS,
        ...overrides,
    })
}

/** The workflow artifact — source of the display name shown in the modal title. */
export function commitArtifact(ids: CommitModalIds, name = "Support Agent"): Workflow {
    return workflowSchema.parse({
        id: ids.workflowId,
        slug: "support-agent",
        name,
        flags: {is_agent: true, is_application: true},
        ...TIMESTAMPS,
    })
}

/**
 * The query keys EntityCommitModal transitively reads for a "variant" entity. Keys are
 * copied from the atoms that own them — that coupling is the honest cost of cache-level
 * seeding:
 */
export function commitModalQueries(
    scope: StoryScope,
    opts?: {revision?: (ids: CommitModalIds) => Workflow},
): [QueryKey, unknown][] {
    const ids = commitModalIds(scope)
    const revision = opts?.revision ? opts.revision(ids) : commitRevision(ids)

    return [
        // workflowQueryAtomFamily                 → workflow/state/store.ts:1187
        //   feeds workflowMolecule.selectors.data/serverData (the adapter's commit context)
        [["workflows", "revision", ids.revisionId, ids.projectId], revision],
        // workflowArtifactScopedQueryAtomFamily   → workflow/state/store.ts:1101
        //   feeds workflowMolecule.selectors.artifactName (the "Commit <name>" title)
        [["workflows", "artifact", ids.workflowId, ids.projectId], commitArtifact(ids)],
    ]
}

// ---------------------------------------------------------------------------
// Delete / save modals (testset adapter → testset molecule)
// ---------------------------------------------------------------------------

export function testsetFixture(id: string, name: string): Testset {
    return testsetSchema.parse({id, name, description: null, ...TIMESTAMPS})
}

/**
 * Seeds the testset detail cache so the delete/save modals resolve display names through
 * the adapter's `dataAtom` instead of the `EntityReference.name` shortcut.
 */
export function testsetQueries(
    scope: StoryScope,
    testsets: {idKey: string; name: string}[],
): [QueryKey, unknown][] {
    return testsets.map(({idKey, name}) => [
        // testsetQueryAtomFamily → testset/state/store.ts:609
        ["testset", scope.projectId, scope.id(idKey)],
        testsetFixture(scope.id(idKey), name),
    ])
}
