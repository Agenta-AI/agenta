import {useEffect, useRef} from "react"

import {useRouter} from "next/router"

import {useOrgData} from "@/oss/state/org"

import {usePostSignupReadiness} from "./hooks/usePostSignupReadiness"
import PostSignupFallback from "./PostSignupFallback"
import PostSignupForm from "./PostSignupForm"
import PostSignupSkeleton from "./PostSignupSkeleton"

/**
 * Gate component for the /post-signup page.
 *
 * Owns all four async dependencies (PostHog SDK, user profile, orgs, survey)
 * through usePostSignupReadiness and renders exactly one of:
 *
 *   - PostSignupSkeleton  while anything is still loading
 *   - PostSignupForm      when every dependency resolved successfully
 *   - PostSignupFallback  when a transient failure happened (network, CDN, ...)
 *   - (redirects)         when a permanent failure happened (no key, survey gone)
 *
 * Downstream components never see "maybe-loaded" data — by the time they
 * render, their props are guaranteed populated. This removes the need for
 * defensive nulls, internal spinners, or per-component timeouts.
 */
const PostSignupRoute = () => {
    const router = useRouter()
    const readiness = usePostSignupReadiness()
    // We also need orgs for the loading/fallback header. Reading it here keeps
    // those branches presentational while the readiness hook stays focused on
    // gating semantics.
    const {orgs} = useOrgData()
    const skipRedirectFiredRef = useRef(false)

    // Every successful exit from this page (Submit, fallback Continue, or
    // permanent-skip redirect) lands on /get-started. Prefetch it on mount so
    // the route swap doesn't show a blank gap while Next.js compiles (dev) or
    // fetches the chunk (prod). Pages-router prefetch is idempotent and safe
    // to call on every mount.
    useEffect(() => {
        void router.prefetch("/get-started")
    }, [router])

    useEffect(() => {
        if (readiness.status !== "skip") {
            skipRedirectFiredRef.current = false
            return
        }
        if (skipRedirectFiredRef.current) return
        skipRedirectFiredRef.current = true
        void router.replace("/get-started")
    }, [readiness, router])

    if (readiness.status === "skip") {
        return <PostSignupSkeleton orgs={orgs ?? []} />
    }

    if (readiness.status === "fallback") {
        return <PostSignupFallback orgs={orgs ?? []} reason={readiness.reason} />
    }

    if (readiness.status === "loading") {
        return <PostSignupSkeleton orgs={orgs ?? []} />
    }

    return (
        <PostSignupForm
            survey={readiness.survey}
            user={readiness.user}
            orgs={readiness.orgs}
            posthog={readiness.posthog}
        />
    )
}

export default PostSignupRoute
