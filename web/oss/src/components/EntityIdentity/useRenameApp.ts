import {useCallback} from "react"

import {invalidateWorkflowsListCache, updateWorkflow} from "@agenta/entities/workflow"

import {GenericObject} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"
import {getProjectValues} from "@/oss/state/project"

import {invalidateAppManagementWorkflowQueries} from "../pages/app-management/store/appWorkflowStore"

/** Payload for an agent/app metadata rename. `id` is the workflow (artifact) id. */
export interface RenameAppPayload {
    id: string
    name?: string
    description?: string
}

const appDisplayName = (app: GenericObject): string => (app?.name ?? app?.slug ?? "") as string

/**
 * Rename/update an agent (workflow artifact) from any surface. Wraps the metadata write and the
 * two cache invalidations that keep the workflows list + app-management tables in sync, and
 * exposes a duplicate-name guard so the inline editors can block a clashing name without a modal.
 */
export const useRenameApp = () => {
    const {apps, mutate} = useAppsData()

    /** True when `name` already belongs to a DIFFERENT app (case-insensitive). */
    const isDuplicateName = useCallback(
        (name: string, selfId?: string) => {
            const candidate = name.trim().toLowerCase()
            if (!candidate) return false
            return (apps as GenericObject[]).some(
                (app) => app?.id !== selfId && appDisplayName(app).toLowerCase() === candidate,
            )
        },
        [apps],
    )

    const renameApp = useCallback(
        async ({id, name, description}: RenameAppPayload): Promise<boolean> => {
            try {
                const {projectId} = getProjectValues()
                await updateWorkflow(projectId, {
                    id,
                    name,
                    description,
                    flags: {is_application: true},
                })
                invalidateWorkflowsListCache()
                await mutate()
                await invalidateAppManagementWorkflowQueries()
                return true
            } catch (error) {
                console.error("[useRenameApp] failed to rename app", error)
                return false
            }
        },
        [mutate],
    )

    return {renameApp, isDuplicateName}
}
