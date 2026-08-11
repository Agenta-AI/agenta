import {useCallback} from "react"

import {message} from "antd"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {appsQueryAtom, recentAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {useAppNavigation} from "@/oss/state/appState"

// Stable empty apps-query read for when the "first app" fallback isn't needed, so
// this hook doesn't subscribe to the whole apps catalog on mount (it's mounted by
// the always-present OnboardingWidget).
const EMPTY_APPS_QUERY_ATOM = atom({data: [] as {app_id?: string}[], isSuccess: false})

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
    const recentAppId = useAtomValue(recentAppIdAtom)
    const setRecentAppId = useSetAtom(recentAppIdAtom)
    // The apps list is only needed for the "first app" fallback when there's NO
    // current and NO recent app (e.g. onboarding from /home). On any normal app
    // route `appId` is present, so we read a stable empty atom — avoiding a
    // mount-time subscription to the whole apps catalog on every page.
    const needsAppFallback = !appId && !recentAppId
    const appsQuery = useAtomValue(needsAppFallback ? appsQueryAtom : EMPTY_APPS_QUERY_ATOM) as {
        data?: {app_id?: string}[]
        isSuccess?: boolean
    }

    const goToPlayground = useCallback(
        (target?: PlaygroundTarget, options?: GoToPlaygroundOptions) => {
            let resolvedAppId: string | null = options?.appId ?? appId ?? recentAppId ?? null
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
                selectedKeys.length > 0 ? `?revisions=${selectedKeys.join(",")}` : ""

            push(`${baseAppURL}/${resolvedAppId}/playground${querySuffix}`)
        },
        [appId, appsQuery, baseAppURL, push, recentAppId, setRecentAppId],
    )

    return {goToPlayground}
}
