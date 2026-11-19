import {useEffect, type ReactNode} from "react"

import {developerModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageNotFound} from "@/components/PageNotFound"

import {useDeveloperViewEnabled} from "./developerViewAccess"

const queryValue = (value: string | string[] | undefined) =>
    typeof value === "string" && value ? value : null

/** Where a hidden view sends the user: the app's agent screen, else the project home. */
export const hiddenViewFallback = (query: Record<string, string | string[] | undefined>) => {
    const workspaceId = queryValue(query.workspace_id)
    const projectId = queryValue(query.project_id)
    if (!workspaceId || !projectId) return null
    const base = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}`
    const appId = queryValue(query.app_id)
    return appId ? `${base}/agents/${encodeURIComponent(appId)}` : `${base}/apps`
}

/**
 * Wraps a developer view's route page: the view when this user may open it, else a redirect to
 * the closest page they have, and nothing while the signed-in user is still unknown.
 * `developerModeOnly` routes exist only in Developer Mode.
 */
export const DeveloperViewGate = ({
    viewId,
    developerModeOnly = false,
    children,
}: {
    viewId: string
    developerModeOnly?: boolean
    children: ReactNode
}) => {
    const router = useRouter()
    const enabled = useDeveloperViewEnabled(viewId)
    const developerMode = useAtomValue(developerModeActiveAtom)
    const allowed = enabled === null ? null : enabled && (developerMode || !developerModeOnly)
    const fallback = allowed === false && router.isReady ? hiddenViewFallback(router.query) : null
    useEffect(() => {
        if (fallback) void router.replace(fallback)
    }, [router, fallback])
    if (allowed === null || fallback) return null
    return allowed ? children : <PageNotFound />
}
