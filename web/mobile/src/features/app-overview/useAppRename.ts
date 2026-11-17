import {useCallback, useRef} from "react"

import {
    appWorkflowsListQueryStateAtom,
    invalidateWorkflowCache,
    invalidateWorkflowsListCache,
    updateWorkflow,
    workflowArtifactQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"

export type DescriptionState = "loading" | "ready" | "failed"

/** The first error a name has, or null. The checks run in this order. */
export const validateAppName = (
    value: string,
    others: readonly {id: string; name?: string | null}[],
    appId: string,
): string | null => {
    const name = value.trim()
    if (!name) return "Name can't be empty"
    const lower = name.toLowerCase()
    const taken = others.some(
        (other) => other.id !== appId && (other.name ?? "").trim().toLowerCase() === lower,
    )
    return taken ? "An app with this name already exists" : null
}

/**
 * Renaming an app: the stored name and description, the duplicate check, and the write.
 *
 * The list does not carry the description, so it comes from the app's own record. Until that
 * record loads `description` is `loading` and the dialog must not save: a save then would write
 * an empty description over the stored one. If the record fails to load, the save leaves the
 * description out of the request and so keeps it.
 */
export const useAppRename = ({projectId, app}: {projectId: string; app: Workflow}) => {
    const artifact = useAtomValue(workflowArtifactQueryAtomFamily(app.id))
    const apps = useAtomValue(appWorkflowsListQueryStateAtom)
    const inFlight = useRef(false)

    const descriptionState: DescriptionState = artifact.data
        ? "ready"
        : artifact.isPending
          ? "loading"
          : "failed"
    const storedDescription = artifact.data?.description ?? ""
    const storedName = artifact.data?.name ?? app.name ?? ""

    const validate = useCallback(
        (value: string) => validateAppName(value, apps.data, app.id),
        [apps.data, app.id],
    )

    const save = useCallback(
        async ({name, description}: {name: string; description: string}): Promise<boolean> => {
            if (inFlight.current) return false
            if (descriptionState === "loading") return false
            inFlight.current = true
            try {
                await updateWorkflow(projectId, {
                    id: app.id,
                    name: name.trim(),
                    description: descriptionState === "ready" ? description : undefined,
                })
            } catch (error) {
                console.error("Renaming an app failed", error)
                message.error("Couldn't rename this app")
                return false
            } finally {
                inFlight.current = false
                // Also after a failure: the package reads the app back after its write, and a
                // failed read leaves a saved rename behind that the caches would not show.
                invalidateWorkflowsListCache()
                invalidateWorkflowCache(app.id)
            }
            return true
        },
        [projectId, app.id, descriptionState],
    )

    return {
        descriptionState,
        /** The app names the duplicate check reads are still loading. */
        namesLoading: apps.isPending,
        storedName,
        storedDescription,
        createdAt: artifact.data?.created_at ?? null,
        validate,
        save,
    }
}
