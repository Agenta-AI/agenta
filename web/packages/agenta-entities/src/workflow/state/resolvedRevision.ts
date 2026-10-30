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
export const resolvedWorkflowRevisionFamilyKey = (refs: WorkflowRevisionRefs | null): string =>
    refs && (refs.workflow || refs.variant || refs.revision || refs.environment)
        ? JSON.stringify(refs)
        : ""

export const resolvedWorkflowRevisionQueryAtomFamily = atomFamily((key: string) =>
    atomWithQuery<ResolvedWorkflowRevision | null>((get) => {
        const projectId = get(projectIdAtom)
        const refs: WorkflowRevisionRefs = key ? JSON.parse(key) : {}
        return {
            queryKey: ["workflows", "resolved-revision", projectId, key],
            queryFn: () => resolveWorkflowRevisionRefs({projectId: projectId as string, refs}),
            enabled: !!projectId && !!key,
            staleTime: 30_000,
        }
    }),
)
