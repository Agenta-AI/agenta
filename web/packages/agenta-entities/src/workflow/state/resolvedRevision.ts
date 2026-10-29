/**
 * The revision a set of references resolves to now, keyed by those references.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    resolveWorkflowRevisionRefs,
    type ResolvedWorkflowRevision,
    type WorkflowRevisionRefs,
} from "../api/resolveRevision"

/** The key of {@link resolvedWorkflowRevisionQueryAtomFamily}; empty means "nothing to resolve". */
export const workflowRevisionRefsKey = (refs: WorkflowRevisionRefs | null): string =>
    refs && (refs.workflowId || refs.variantId || refs.revisionId)
        ? JSON.stringify([refs.workflowId ?? null, refs.variantId ?? null, refs.revisionId ?? null])
        : ""

export const resolvedWorkflowRevisionQueryAtomFamily = atomFamily((key: string) =>
    atomWithQuery<ResolvedWorkflowRevision | null>((get) => {
        const projectId = get(projectIdAtom)
        const [workflowId = null, variantId = null, revisionId = null] = key
            ? (JSON.parse(key) as (string | null)[])
            : []
        return {
            queryKey: ["workflows", "resolved-revision", projectId, key],
            queryFn: () =>
                resolveWorkflowRevisionRefs({
                    projectId: projectId as string,
                    refs: {workflowId, variantId, revisionId},
                }),
            enabled: !!projectId && !!key,
            staleTime: 30_000,
        }
    }),
)
