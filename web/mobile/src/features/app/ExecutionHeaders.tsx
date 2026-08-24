import {useEffect} from "react"

import {executionItemController} from "@agenta/playground"
import {useSetAtom} from "jotai"

import {getAccessToken} from "@/lib/auth"

/** Bearer token for playground run requests, or nothing when there is no session. */
const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken()
    return token ? {Authorization: `Bearer ${token}`} : {}
}

/**
 * Registers the auth-header provider the playground's run requests use. web/oss does the same in
 * DeferredAppBoot; /m never did, and the consequence was not a 401 — it was a run against the
 * WRONG PROJECT.
 *
 * `buildAgentRequest` appends `project_id` to the invoke URL only alongside an Authorization
 * header, so with no provider registered /m sent `/invoke?application_id=…` and nothing else. The
 * backend takes a request's project from that query param and, with none, falls back to the
 * caller's DEFAULT project — so the run resolved its model connection against the default
 * project's vault and reported the agent's own connection missing
 * ("connection '<slug>' not found for provider 'anthropic'").
 */
export const ExecutionHeaders = () => {
    const setHeaders = useSetAtom(executionItemController.actions.setExecutionHeaders)
    useEffect(() => {
        setHeaders(() => getAuthHeaders)
    }, [setHeaders])
    return null
}
