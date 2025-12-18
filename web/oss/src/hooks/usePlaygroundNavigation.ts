import {useCallback} from "react"

import {useSetAtom} from "jotai"

import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {recentAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {useAppNavigation} from "@/oss/state/appState"

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
interface GoToPlaygroundOptions {
    appId?: string | null
}

export const usePlaygroundNavigation = () => {
    const appId = useAppId()
    const {push} = useAppNavigation()
    const {baseAppURL} = useURL()
    const setRecentAppId = useSetAtom(recentAppIdAtom)

    const goToPlayground = useCallback(
        (target?: PlaygroundTarget, options?: GoToPlaygroundOptions) => {
            const resolvedAppId = options?.appId ?? appId
            if (!resolvedAppId) return
            const selectedKeys = Array.from(
                new Set(
                    normalizeRevisionIds(target).filter(
                        (id) => typeof id === "string" && id.trim().length > 0,
                    ),
                ),
            )
            if (options?.appId) {
                setRecentAppId(options.appId)
            }
            const querySuffix =
                selectedKeys.length > 0
                    ? `?playgroundRevisions=${encodeURIComponent(JSON.stringify(selectedKeys))}`
                    : ""

            push(`${baseAppURL}/${resolvedAppId}/playground${querySuffix}`)
        },
        [appId, baseAppURL, push, setRecentAppId],
    )

    return {goToPlayground}
}
