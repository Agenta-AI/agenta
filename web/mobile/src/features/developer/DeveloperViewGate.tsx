import type {ReactNode} from "react"

import {PageNotFound} from "@/components/PageNotFound"

import {useDeveloperViewEnabled} from "./developerViewAccess"

/**
 * Wraps a developer view's route page: the view when this user may open it, the app's
 * "not found" page when not, and nothing while the signed-in user is still unknown.
 */
export const DeveloperViewGate = ({viewId, children}: {viewId: string; children: ReactNode}) => {
    const enabled = useDeveloperViewEnabled(viewId)
    if (enabled === null) return null
    return enabled ? children : <PageNotFound />
}
