"use client"

import {useClassicModeCookieSync, useClassicModeRedirect} from "@agenta/shared/hooks"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {authFlowAtom} from "@/oss/state/session"
import {handPendingTemplateToMobile} from "@/oss/state/url/template"

/**
 * Null-rendering: mirrors Classic mode to a cookie, and hops to `/m` on the first visit.
 * Waits for a settled session — mid sign-in the id is known but post-auth routing has not run.
 * Re-checks on every route: sign-in and post-signup leave by client-side push, not a page load.
 */
const ClassicModeGate = () => {
    const authFlow = useAtomValue(authFlowAtom)
    const {asPath} = useRouter()

    useClassicModeCookieSync()
    useClassicModeRedirect(authFlow === "authed", asPath, handPendingTemplateToMobile)

    return null
}

export default ClassicModeGate
