import {useCallback} from "react"

import {useSetAtom} from "jotai"

import {useAppId} from "@/oss/hooks/useAppId"
import {playgroundNavigationRequestAtom} from "@/oss/state/variant/atoms/navigation"

interface VariantLike {
    id?: string
    _revisionId?: string
    revisionId?: string
    deployed_app_variant_revision_id?: string
    variant?: {id?: string}
}

export type PlaygroundTarget = string | VariantLike | (string | VariantLike)[]

const extractRevisionId = (x: VariantLike): string | undefined => {
    return (
        x?._revisionId ||
        x?.revisionId ||
        x?.id ||
        x?.deployed_app_variant_revision_id ||
        x?.variant?.id ||
        undefined
    )
}

export const normalizeRevisionIds = (target?: PlaygroundTarget): string[] => {
    if (!target) return []
    if (typeof target === "string") return [target]
    if (Array.isArray(target)) {
        const out: string[] = []
        target.forEach((t) => {
            out.push(...normalizeRevisionIds(t))
        })
        return out
    }
    const id = extractRevisionId(target)
    return id ? [id] : []
}

/**
 * Reusable navigation helper for redirecting to Playground.
 * Uses the global PlaygroundNavigator via jotai to centralize routing logic.
 */
export const usePlaygroundNavigation = () => {
    const appId = useAppId()
    const requestPlaygroundNav = useSetAtom(playgroundNavigationRequestAtom)

    const goToPlayground = useCallback(
        (target?: PlaygroundTarget) => {
            const selectedKeys = normalizeRevisionIds(target)
            requestPlaygroundNav(selectedKeys.length > 0 ? {appId, selectedKeys} : {appId})
        },
        [appId, requestPlaygroundNav],
    )

    return {goToPlayground}
}
