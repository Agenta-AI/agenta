import type {ReactNode} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {useDeveloperViewEnabled} from "./developerViewAccess"

import {PageNotFound} from "@/components/PageNotFound"

/**
 * Wraps a developer view's route page: the view when this user may open it (any of the views,
 * for a list), the app's "not found" page when not, and nothing while the signed-in user is
 * still unknown.
 * `betaOnly` routes exist only in beta developer mode.
 */
export const DeveloperViewGate = ({
    viewId,
    betaOnly = false,
    children,
}: {
    viewId: string | readonly string[]
    betaOnly?: boolean
    children: ReactNode
}) => {
    const enabled = useDeveloperViewEnabled(viewId)
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    if (enabled === null) return null
    return enabled && (beta || !betaOnly) ? children : <PageNotFound />
}
