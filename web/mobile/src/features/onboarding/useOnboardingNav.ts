import {useCallback} from "react"

import {useRouter} from "next/router"

import {onboardingRoutePath, parseOnboardingRoute, type OnboardingRoute} from "./onboardingRoute"

/** `?return=<path>`: where credits' Continue leads after a detour from a later step. */
const RETURN_PARAM = "return"

const segmentsOf = (value: string | string[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value]

export interface OnboardingNavigateOptions {
    replace?: boolean
    returnTo?: OnboardingRoute
}

/** The flow's position read from and written to `<base>/onboarding/[[...step]]`. */
export const useOnboardingNav = (onboardingPath: string) => {
    const router = useRouter()
    const returnParam = router.query[RETURN_PARAM]
    const returnTo =
        typeof returnParam === "string" && returnParam
            ? parseOnboardingRoute(returnParam.split("/"))
            : null

    const navigate = useCallback(
        (route: OnboardingRoute, {replace = false, returnTo}: OnboardingNavigateOptions = {}) => {
            const path = onboardingRoutePath(route)
            const query = returnTo
                ? `?${RETURN_PARAM}=${encodeURIComponent(onboardingRoutePath(returnTo))}`
                : ""
            const url = `${onboardingPath}/${path}${query}`
            const options = {shallow: true, scroll: false}
            void (replace
                ? router.replace(url, undefined, options)
                : router.push(url, undefined, options))
        },
        [onboardingPath, router],
    )

    return {
        ready: router.isReady,
        requested: parseOnboardingRoute(segmentsOf(router.query.step)),
        returnTo,
        navigate,
        back: () => router.back(),
    }
}
