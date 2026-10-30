/** Personal MCP sign-in and sign-out for the caller (`owner_kind=user`). */
import {useCallback, useEffect, useRef, useState} from "react"

import {getAgentaApiUrl, getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {invalidatePersonalAccountReads} from "../../accountChoice/state"
import {
    beginPersonalMcpSignIn,
    cancelMcpConnectAttempt,
    fetchMcpConnectAttempt,
    signInToMcpEndpointWithToken,
    signOutOfMcpEndpoint,
} from "../api/api"
import {buildTrustedOrigins} from "../core/connectMessage"
import {watchOauthConsent} from "../core/connectWatch"
import {gatewayRefusalCode} from "../core/refusal"
import {rememberMcpReturnPath} from "../core/returnPath"
import type {MCPEndpoint} from "../core/types"
import {MCP_ENDPOINTS_QUERY_KEY} from "../state/atoms"

const POPUP_NAME = "agenta-mcp-personal-sign-in"
const POPUP_FEATURES = "popup,width=520,height=720"
/** The server was never connected by the project, so a person cannot sign in to it yet. */
const SERVER_NOT_DISCOVERED = "server_not_discovered"

/**
 * The newest OAuth sign-in, across every mounted table: all of them share one named popup, so
 * the answer to an older start request must not touch the popup a newer one uses.
 */
let newestSignIn = 0

/** The reads that show a person's sign-in: the server list, the run accounts, Needs setup. */
const refreshSignInReads = async () => {
    await Promise.all([
        getHostQueryClient().invalidateQueries({queryKey: [MCP_ENDPOINTS_QUERY_KEY]}),
        invalidatePersonalAccountReads(),
    ])
}

export interface PersonalMcpSignIn {
    /** The server with a sign-in or sign-out in flight; concurrent calls do nothing. */
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
    // Set at once, unlike the state, so a second click in the same frame is refused.
    const busyRef = useRef(false)

    const begin = useCallback((endpointId: string) => {
        if (busyRef.current) return false
        busyRef.current = true
        setPendingId(endpointId)
        setError(null)
        return true
    }, [])

    const mountedRef = useRef(true)
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            stopWatchRef.current?.()
        }
    }, [])

    const finish = useCallback(async (failure: string | null) => {
        stopWatchRef.current?.()
        stopWatchRef.current = null
        busyRef.current = false
        setError(failure)
        setPendingId(null)
        await refreshSignInReads()
    }, [])

    const signIn = useCallback(
        (endpoint: MCPEndpoint) => {
            const endpointId = endpoint.id
            if (!endpointId || !begin(endpointId)) return
            // Opened blank inside the click: WebKit blocks a popup opened after an await.
            const popup = window.open("", POPUP_NAME, POPUP_FEATURES)
            const scopes = endpoint.data.oauth_config?.scopes ?? []
            const signInNumber = ++newestSignIn
            // The table left, or a newer sign-in took the popup, while the start request ran.
            const stale = () => !mountedRef.current || signInNumber !== newestSignIn
            const dropStale = (attemptId?: string | null) => {
                if (attemptId) {
                    void cancelMcpConnectAttempt(endpointId, attemptId, projectId).catch(
                        () => undefined,
                    )
                }
                // The popup is still this sign-in's only when nothing newer started.
                if (signInNumber === newestSignIn) popup?.close()
                // Another table took over: this one is free again.
                if (mountedRef.current) void finish(null)
            }
            void (async () => {
                try {
                    const result = await beginPersonalMcpSignIn(endpointId, scopes, projectId)
                    const redirectUrl = result?.redirect_url
                    const attemptId = result?.attempt_id
                    const expiresIn = result?.expires_in
                    if (stale()) {
                        dropStale(attemptId)
                        return
                    }
                    if (!redirectUrl || !attemptId || !expiresIn) {
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
                        timeoutMs: expiresIn * 1000,
                        onConnected: () => void finish(null),
                        onFailed: () => {
                            void cancelMcpConnectAttempt(endpointId, attemptId, projectId).catch(
                                () => undefined,
                            )
                            void finish("The sign-in did not finish. Try again.")
                        },
                    })
                    popup.location.href = redirectUrl
                } catch (failure) {
                    if (stale()) {
                        dropStale()
                        return
                    }
                    popup?.close()
                    await finish(
                        gatewayRefusalCode(failure) === SERVER_NOT_DISCOVERED
                            ? "A project admin must connect this server once first."
                            : "Could not start the sign-in. Try again.",
                    )
                }
            })()
        },
        [begin, finish, projectId],
    )

    const signInWithToken = useCallback(
        async (endpoint: MCPEndpoint, token: string) => {
            if (!endpoint.id || !begin(endpoint.id)) return false
            try {
                await signInToMcpEndpointWithToken(endpoint.id, token, projectId)
                await finish(null)
                return true
            } catch {
                await finish("Could not save the token. Check it and try again.")
                return false
            }
        },
        [begin, finish, projectId],
    )

    const signOut = useCallback(
        async (endpoint: MCPEndpoint) => {
            if (!endpoint.id || !begin(endpoint.id)) return
            try {
                await signOutOfMcpEndpoint(endpoint.id, projectId)
                await finish(null)
            } catch {
                await finish("Could not sign out. Try again.")
            }
        },
        [begin, finish, projectId],
    )

    return {pendingId, error, signIn, signInWithToken, signOut}
}
