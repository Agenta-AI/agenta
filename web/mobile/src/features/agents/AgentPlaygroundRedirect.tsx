import {useEffect, useState, type ReactNode} from "react"

import Router from "next/router"

import {startBlankSession} from "../chat/useStartBlankSession"

/** Forwards an in-app agent link to a blank playground session while the overview is off. */
export const AgentPlaygroundRedirect = ({
    base,
    agentId,
    fallback,
}: {
    base: string
    agentId: string
    /** Shown when the forward fails, so the route never stays blank. */
    fallback: ReactNode
}) => {
    const [failed, setFailed] = useState(false)
    useEffect(() => {
        const onError = () => setFailed(true)
        Router.events.on("routeChangeError", onError)
        startBlankSession(base, agentId, "replace")
        return () => Router.events.off("routeChangeError", onError)
    }, [agentId, base])
    return failed ? fallback : null
}
