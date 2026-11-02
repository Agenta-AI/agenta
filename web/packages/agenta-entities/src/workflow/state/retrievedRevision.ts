/**
 * The revision a set of references resolves to now, keyed by those references.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    retrieveWorkflowRevisionByRefs,
    type RetrievedWorkflowRevision,
    type WorkflowRevisionRefs,
} from "../api/retrieveRevisionByRefs"

/** The key of {@link retrievedWorkflowRevisionQueryAtomFamily}; empty means "nothing to resolve". */
export const retrievedWorkflowRevisionFamilyKey = (refs: WorkflowRevisionRefs | null): string =>
    refs && (refs.workflow || refs.variant || refs.revision || refs.environment)
        ? JSON.stringify(refs)
        : ""

export const retrievedWorkflowRevisionQueryAtomFamily = atomFamily((key: string) =>
    atomWithQuery<RetrievedWorkflowRevision | null>((get) => {
        const projectId = get(projectIdAtom)
        const refs: WorkflowRevisionRefs = key ? JSON.parse(key) : {}
        return {
            queryKey: ["workflows", "retrieved-revision", projectId, key],
            queryFn: () => retrieveWorkflowRevisionByRefs({projectId: projectId as string, refs}),
            enabled: !!projectId && !!key,
            staleTime: 30_000,
        }
    }),
)
