import {useEffect, useRef} from "react"

import deepEqual from "fast-deep-equal"
import {useAtom, useAtomValue} from "jotai"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {useIsomorphicLayoutEffect} from "usehooks-ts"

import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

import {urlRevisionsAtom, userSaveStateAtom} from "./atoms"
import {selectedVariantsAtom, viewTypeAtom} from "./atoms/core"

const PlaygroundDerivedListener = () => {
    const router = useRouter()
    const [urlRevisions, setUrlRevisions] = useAtom(urlRevisionsAtom)
    const selectedVariants = useAtomValue(selectedVariantsAtom)
    const userSaveState = useAtomValue(userSaveStateAtom)
    const setSelectedVariants = useSetAtom(selectedVariantsAtom)
    const setViewType = useSetAtom(viewTypeAtom)
    const revisions = useAtomValue(revisionListAtom)

    const hasInitializedRef = useRef(false)
    const hasAdoptedUrlRef = useRef(false)
    const prevAppIdRef = useRef<string | undefined>(undefined)
    const prevWasPlaygroundRef = useRef<boolean>(false)

    const isPlaygroundRoute = router.pathname.includes("/playground")

    // Track previous route context
    useEffect(() => {
        if (!router.isReady) return
        prevWasPlaygroundRef.current = isPlaygroundRoute
        prevAppIdRef.current = router.query.app_id as string | undefined
    }, [router.isReady, isPlaygroundRoute, router.query.app_id])

    // Reset URL adoption state when entering Playground or switching apps
    useIsomorphicLayoutEffect(() => {
        if (!router.isReady) return
        const currentAppId = router.query.app_id as string | undefined
        const prevAppId = prevAppIdRef.current
        const prevWasPlayground = prevWasPlaygroundRef.current

        const enteringPlayground = isPlaygroundRoute && !prevWasPlayground
        const switchingApps = prevAppId !== undefined && prevAppId !== currentAppId

        if (enteringPlayground || switchingApps) {
            hasAdoptedUrlRef.current = false
        }
    }, [router.isReady, isPlaygroundRoute, router.query.app_id])

    // Reset state when switching apps (not initial load), but preserve deep links that land directly with revisions
    useIsomorphicLayoutEffect(() => {
        if (!router.isReady) return

        const currentAppId = router.query.app_id as string | undefined
        const prevAppId = prevAppIdRef.current
        const prevWasPlayground = prevWasPlaygroundRef.current

        const isAppSwitchInsidePlayground =
            prevWasPlayground && prevAppId && currentAppId && prevAppId !== currentAppId

        // Only reset atoms when app actually changes AND we know the previous app (not initial load)
        if (prevAppId !== undefined && prevAppId !== currentAppId) {
            hasInitializedRef.current = false
            setSelectedVariants([])
            // Only clear urlRevisions if we don't have revisions in URL (preserve deep link)
            if (!router.query.revisions) {
                setUrlRevisions([])
            }
            // No bypass: rely on revisions becoming available to trigger initial selection
        }

        // Only strip revisions from URL if we *navigated within the app* from another playground
        // (don’t strip on initial deep link that includes revisions)
        if (isAppSwitchInsidePlayground && router.query.revisions) {
            const {revisions, ...rest} = router.query
            router.replace({pathname: router.pathname, query: rest}, undefined, {shallow: true})
        }
    }, [router.isReady, router.query.app_id, router.pathname, setSelectedVariants, setUrlRevisions])

    // Listen for revisions and react when available.

    // Mark initialization complete once new variants are loaded
    useEffect(() => {
        if (selectedVariants.length > 0) {
            hasInitializedRef.current = true
        }
    }, [selectedVariants])

    // Handle URL -> atom sync for deep linking
    useEffect(() => {
        if (!router.isReady) return

        if (!isPlaygroundRoute) {
            // On non-playground routes, do not clear selection state.
            // Preserving selection allows returning to Playground in comparison mode.
            return
        }

        const getUrlRevisions = (): string[] => {
            if (!router.query.revisions) {
                return []
            }
            try {
                if (typeof router.query.revisions === "string") {
                    const raw = router.query.revisions
                    // Try direct JSON.parse first (Next.js often provides decoded value)
                    try {
                        const parsed = JSON.parse(raw)

                        return parsed
                    } catch (_) {
                        // Fallback: decodeURIComponent then parse
                        const decoded = JSON.parse(decodeURIComponent(raw))
                        return decoded
                    }
                }
                return []
            } catch (error) {
                return []
            }
        }

        const newUrlRevisions = getUrlRevisions()

        // Always sync URL revisions when on playground route and URL has revisions
        if (newUrlRevisions.length > 0 && !deepEqual(newUrlRevisions, urlRevisions)) {
            setUrlRevisions(newUrlRevisions)
        }
    }, [
        router.isReady,
        isPlaygroundRoute,
        router.query.revisions,
        setUrlRevisions,
        router.pathname,
    ])

    // Trigger state synchronization when needed (initial load or recent user save)
    useEffect(() => {
        if (!router.isReady || !isPlaygroundRoute) return

        const isInitialLoad = selectedVariants.length === 0
        const isRecentUserSave = userSaveState?.isRecentUserSave
        const shouldTriggerSync = isInitialLoad || isRecentUserSave
        if (!shouldTriggerSync) return

        const urlHasRevisions = Boolean(router.query.revisions)

        // Respect deep-link revisions when present
        if (
            isInitialLoad &&
            urlHasRevisions &&
            Array.isArray(urlRevisions) &&
            urlRevisions.length
        ) {
            setSelectedVariants(urlRevisions)
            setViewType(urlRevisions.length > 1 ? "comparison" : "single")
            return
        }

        // Fallback to latest once revisions are available
        if (isInitialLoad && !urlHasRevisions && revisions.length > 0) {
            const latestRevisionId = revisions[0]?.id
            if (latestRevisionId) {
                setSelectedVariants([latestRevisionId])
                setViewType("single")
            }
        }
    }, [
        router.isReady,
        isPlaygroundRoute,
        selectedVariants.length,
        revisions,
        urlRevisions,
        router.query.revisions,
        userSaveState?.isRecentUserSave,
        userSaveState?.userSavedVariant,
    ])

    // Adopt URL-provided revisions exactly once per entry to Playground.
    // After adoption, further selection is driven by atoms and we only push to URL (not pull).
    useEffect(() => {
        if (!router.isReady || !isPlaygroundRoute) return
        if (hasAdoptedUrlRef.current) return

        const urlHasRevisions = Boolean(router.query.revisions) && urlRevisions.length > 0
        if (!urlHasRevisions) return

        if (!deepEqual(urlRevisions, selectedVariants)) {
            setSelectedVariants(urlRevisions)
            setViewType(urlRevisions.length > 1 ? "comparison" : "single")
        }
        // Mark adopted whether we changed selection or it already matched
        hasAdoptedUrlRef.current = true
    }, [
        router.isReady,
        isPlaygroundRoute,
        router.query.revisions,
        urlRevisions,
        selectedVariants,
        setSelectedVariants,
        setViewType,
    ])

    // Update URL when selectedVariants change (post-init only)
    useEffect(() => {
        if (!router.isReady || !isPlaygroundRoute) return
        if (!router.query.app_id || selectedVariants.length === 0 || !hasInitializedRef.current)
            return

        // If arriving with revisions in the URL, avoid overriding them until we've
        // explicitly adopted those URL revisions into selection.
        if (router.query.revisions && !hasAdoptedUrlRef.current) return

        const newRevisionsParam = buildRevisionsQueryParam(
            selectedVariants as (string | null | undefined)[],
        )
        const currentRevisions =
            typeof router.query.revisions === "string" ? router.query.revisions : undefined

        // Only update URL if it's different from current state
        if (currentRevisions !== newRevisionsParam) {
            const {revisions: _oldRevisions, ...rest} = router.query
            const newQuery = newRevisionsParam
                ? {
                      ...rest,
                      revisions: newRevisionsParam,
                  }
                : {
                      ...rest,
                  }

            // Shallow update - doesn't trigger re-renders
            router.replace({pathname: router.pathname, query: newQuery}, undefined, {shallow: true})
        }
    }, [
        router.isReady,
        isPlaygroundRoute,
        selectedVariants,
        router.query.app_id,
        router.query.revisions,
        router.pathname,
        router.query.revisions,
        revisions,
        setSelectedVariants,
        setViewType,
    ])

    return null
}

export default PlaygroundDerivedListener
