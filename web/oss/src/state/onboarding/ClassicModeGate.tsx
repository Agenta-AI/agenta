"use client"

import {useClassicModeCookieSync, useClassicModeRedirect} from "@agenta/shared/hooks"
import {useAtomValue} from "jotai"

import {authFlowAtom} from "@/oss/state/session"

/**
 * Null-rendering: mirrors Classic mode to a cookie, and hops to `/m` on the first visit.
 * Waits for a settled session — mid sign-in the id is known but post-auth routing has not run.
 */
const ClassicModeGate = () => {
    const authFlow = useAtomValue(authFlowAtom)

    useClassicModeCookieSync()
    useClassicModeRedirect(authFlow === "authed")

    return null
}

export default ClassicModeGate
