import type {ReactNode} from "react"

import {developerModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {PageNotFound} from "@/components/PageNotFound"

import {useDeveloperViewEnabled} from "./developerViewAccess"

/**
 * Wraps a developer view's route page: the view when this user may open it, the app's
 * "not found" page when not, and nothing while the signed-in user is still unknown.
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
    const enabled = useDeveloperViewEnabled(viewId)
    const developerMode = useAtomValue(developerModeActiveAtom)
    if (enabled === null) return null
    return enabled && (developerMode || !developerModeOnly) ? children : <PageNotFound />
}
