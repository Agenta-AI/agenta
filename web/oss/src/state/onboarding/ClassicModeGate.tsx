"use client"

import {useClassicModeCookieSync, useClassicModeRedirect} from "@agenta/shared/hooks"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {authFlowAtom} from "@/oss/state/session"

/**
 * Null-rendering: mirrors Classic mode to a cookie, and hops to `/m` on the first visit.
 * Waits for a settled session — mid sign-in the id is known but post-auth routing has not run —
 * and re-checks on every route change, so the hop fires once sign-in has pushed off `/auth`.
 */
const ClassicModeGate = () => {
    const authFlow = useAtomValue(authFlowAtom)
    const {asPath} = useRouter()

    useClassicModeCookieSync()
    useClassicModeRedirect(authFlow === "authed", asPath)

    return null
}

export default ClassicModeGate
