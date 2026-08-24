"use client"

import {useClassicModeCookieSync, useClassicModeRedirect} from "@agenta/shared/hooks"
import {useAtomValue} from "jotai"

import {authFlowAtom} from "@/oss/state/session"

/**
 * Null-rendering: publishes this user's Classic mode preference as a cookie for the middleware,
 * and — on the first visit, before that cookie exists — performs the hop to `/m` in the client.
 *
 * The hop waits for a settled session. Mid sign-in the user id is already known while the
 * post-auth routing (invite accept, post-signup survey) has not run yet, and jumping apps there
 * would strand people part-way through signing up.
 */
const ClassicModeGate = () => {
    const authFlow = useAtomValue(authFlowAtom)

    useClassicModeCookieSync()
    useClassicModeRedirect(authFlow === "authed")

    return null
}

export default ClassicModeGate
