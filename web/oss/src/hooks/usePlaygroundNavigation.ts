import {useCallback} from "react"

import {message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {appsQueryAtom, recentAppIdAtom} from "@/oss/state/app/atoms/fetcher"
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
    const appsQuery = useAtomValue(appsQueryAtom)
    const recentAppId = useAtomValue(recentAppIdAtom)
    const setRecentAppId = useSetAtom(recentAppIdAtom)

    const goToPlayground = useCallback(
        (target?: PlaygroundTarget, options?: GoToPlaygroundOptions) => {
            let resolvedAppId = options?.appId ?? appId ?? recentAppId ?? null
            const apps = appsQuery?.data ?? []

            if (!resolvedAppId && appsQuery?.isSuccess) {
                if (apps.length === 0) {
                    message.info("Create an application to explore the playground.")
                    return
                }
                resolvedAppId = apps[0]?.app_id ?? null
            }

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
            } else if (!appId && resolvedAppId && resolvedAppId !== recentAppId) {
                setRecentAppId(resolvedAppId)
            }
            const querySuffix =
                selectedKeys.length > 0
                    ? `?playgroundRevisions=${encodeURIComponent(JSON.stringify(selectedKeys))}`
                    : ""

            push(`${baseAppURL}/${resolvedAppId}/playground${querySuffix}`)
        },
        [appId, appsQuery, baseAppURL, push, recentAppId, setRecentAppId],
    )

    return {goToPlayground}
}
