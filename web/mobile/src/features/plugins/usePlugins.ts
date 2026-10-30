import {
    fetchLatestWorkflowRevisions,
    queryWorkflows,
    retrieveWorkflowRevision,
} from "@agenta/entities/workflow"
import {useQuery} from "@tanstack/react-query"

export function usePlugins(projectId: string) {
    return useQuery({
        queryKey: ["plugins", projectId],
        enabled: Boolean(projectId),
        queryFn: async () => {
            const {workflows} = await queryWorkflows({
                projectId,
                flags: {is_evaluator: false},
            })
            const revisions = await fetchLatestWorkflowRevisions(
                projectId,
                workflows.map((row) => row.id),
            )
            return revisions
                .filter((row) => row.flags?.is_plugin)
                .map((revision) => {
                    const artifact = workflows.find((row) => row.id === revision.workflow_id)
                    return {
                        id: revision.workflow_id ?? revision.id,
                        revisionId: revision.id,
                        name: artifact?.name ?? revision.name ?? "Untitled plugin",
                        createdById: artifact?.created_by_id,
                        updatedAt: revision.updated_at ?? revision.created_at,
                    }
                })
        },
    })
}
export function usePlugin(projectId: string, workflowId: string) {
    return useQuery({
        queryKey: ["plugin", projectId, workflowId],
        enabled: Boolean(projectId && workflowId),
        queryFn: async () => {
            const revision = await retrieveWorkflowRevision({
                projectId,
                workflowRef: {id: workflowId},
            })
            if (!revision?.flags?.is_plugin)
                throw new Error("This plugin is unavailable or you do not have access.")
            return revision
        },
    })
}
export type PluginRow = NonNullable<ReturnType<typeof usePlugins>["data"]>[number]
