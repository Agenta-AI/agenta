import {retrieveWorkflowRevision} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

/**
 * The agent's LATEST revision, by workflow artifact id.
 *
 * Configuration lives on a revision, never on the artifact: reading the artifact's own entity
 * gives a workflow with no parameters, which is why the summary rendered "Not set" for every row.
 * `retrieveWorkflowRevision` with only a workflow ref resolves the latest revision of the
 * resolved variant, which is exactly "what this agent is configured as right now".
 */
export const agentLatestRevisionAtomFamily = atomFamily((appId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: ["agent-overview", "latest-revision", projectId, appId],
            queryFn: () =>
                retrieveWorkflowRevision({
                    projectId,
                    workflowRef: {id: appId},
                    lowPriority: true,
                }),
            enabled: Boolean(projectId && appId),
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        }
    }),
)
