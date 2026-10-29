/**
 * The caller's own sign-in to one of the project's MCP servers (`owner_kind=user`).
 *
 * An OAuth server opens the provider's consent in a popup, reusing the project's client
 * registration; a token server takes the person's token. Signing out deletes only the person's
 * own sign-in. Every outcome refreshes the server list, whose `user_sign_in` is the state.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {getAgentaApiUrl, getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {
    beginMcpConnect,
    cancelMcpConnectAttempt,
    disconnectMcpEndpoint,
    fetchMcpConnectAttempt,
    signInMcpWithToken,
} from "../api/api"
import {buildTrustedOrigins} from "../core/connectMessage"
import {watchOauthConsent} from "../core/connectWatch"
import {rememberMcpReturnPath} from "../core/returnPath"
import type {MCPEndpoint} from "../core/types"
import {MCP_ENDPOINTS_QUERY_KEY} from "../state/atoms"

const POPUP_NAME = "agenta-mcp-personal-sign-in"
const POPUP_FEATURES = "popup,width=520,height=720"

/** The reads that show a person's sign-in: the server list, the run accounts, Needs setup. */
const refreshSignInReads = async () => {
    const client = getHostQueryClient()
    await Promise.all([
        client.invalidateQueries({queryKey: [MCP_ENDPOINTS_QUERY_KEY]}),
        client.invalidateQueries({queryKey: ["account-choices"]}),
        client.invalidateQueries({queryKey: ["workflows", "requirements"]}),
    ])
}

export interface PersonalMcpSignIn {
    /** The server whose sign-in is in flight, if any. */
    pendingId: string | null
    /** Why the last attempt did not finish, in words a person can read. */
    error: string | null
    /** Start the OAuth consent. Call it inside the click: the popup opens before any wait. */
    signIn: (endpoint: MCPEndpoint) => void
    /** Store the person's token for a token server. */
    signInWithToken: (endpoint: MCPEndpoint, token: string) => Promise<boolean>
    signOut: (endpoint: MCPEndpoint) => Promise<void>
}

export function usePersonalMcpSignIn(): PersonalMcpSignIn {
    const projectId = useAtomValue(projectIdAtom) ?? undefined
    const [pendingId, setPendingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const stopWatchRef = useRef<(() => void) | null>(null)

    useEffect(() => () => stopWatchRef.current?.(), [])

    const finish = useCallback(async (failure: string | null) => {
        stopWatchRef.current?.()
        stopWatchRef.current = null
        setError(failure)
        setPendingId(null)
        await refreshSignInReads()
    }, [])

    const signIn = useCallback(
        (endpoint: MCPEndpoint) => {
            const endpointId = endpoint.id
            if (!endpointId) return
            // Opened blank inside the click: WebKit blocks a popup opened after an await.
            const popup = window.open("", POPUP_NAME, POPUP_FEATURES)
            setPendingId(endpointId)
            setError(null)
            const scopes = endpoint.data.oauth_config?.scopes ?? []
            void (async () => {
                try {
                    const result = await beginMcpConnect(endpointId, scopes, projectId, "user")
                    const {redirect_url: redirectUrl, attempt_id: attemptId} = result
                    if (!redirectUrl || !attemptId || !result.expires_in) {
                        popup?.close()
                        await finish("Could not start the sign-in. Try again.")
                        return
                    }
                    if (!popup) {
                        rememberMcpReturnPath()
                        window.location.assign(redirectUrl)
                        return
                    }
                    stopWatchRef.current?.()
                    stopWatchRef.current = watchOauthConsent({
                        popup,
                        attemptId,
                        trustedOrigins: buildTrustedOrigins([getAgentaApiUrl()]),
                        target: window,
                        checkOutcome: async () =>
                            (await fetchMcpConnectAttempt(endpointId, attemptId, projectId))
                                .attempt ?? null,
                        timeoutMs: result.expires_in * 1000,
                        onConnected: () => void finish(null),
                        onFailed: () => {
                            void cancelMcpConnectAttempt(endpointId, attemptId, projectId).catch(
                                () => undefined,
                            )
                            void finish("The sign-in did not finish. Try again.")
                        },
                    })
                    popup.location.href = redirectUrl
                } catch {
                    popup?.close()
                    await finish("Could not start the sign-in. Try again.")
                }
            })()
        },
        [finish, projectId],
    )

    const signInWithToken = useCallback(
        async (endpoint: MCPEndpoint, token: string) => {
            if (!endpoint.id) return false
            setPendingId(endpoint.id)
            setError(null)
            try {
                await signInMcpWithToken(endpoint.id, token, projectId)
                await finish(null)
                return true
            } catch {
                await finish("Could not save the token. Check it and try again.")
                return false
            }
        },
        [finish, projectId],
    )

    const signOut = useCallback(
        async (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            setPendingId(endpoint.id)
            setError(null)
            try {
                await disconnectMcpEndpoint(endpoint.id, projectId, "user")
                await finish(null)
            } catch {
                await finish("Could not sign out. Try again.")
            }
        },
        [finish, projectId],
    )

    return {pendingId, error, signIn, signInWithToken, signOut}
}
