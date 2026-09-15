/**
 * Drives the connect journey: the reducer decides what state to be in, this does the
 * network, the popup and the timers that get it there.
 *
 * Two mechanics here are load-bearing and easy to lose in a refactor.
 *
 * The consent popup is opened blank and synchronously inside the tap that confirms the
 * scopes, before any `await`. WebKit blocks `window.open` once a promise has resolved, which
 * is how the mobile app ended up with a flow that silently did nothing. Only the scope step
 * opens one, so a server that needs no consent never flashes a window.
 *
 * The endpoint row is created before consent, because the API has nothing to attach a grant
 * to otherwise, and it is deleted again if the person cancels. A row this journey did not
 * create — a reconnect — is never deleted.
 *
 * Nothing is written to the row after consent. The edit route is a full replace, and the
 * callback has by then stored a `secret_id` this client never saw, so a PUT to flip a flag
 * would wipe the grant the journey just obtained. Until authorization lands, the row carries
 * no credential and every surface reads it as needing one, which is what it is.
 */
import {useCallback, useMemo, useReducer, useRef} from "react"

import {getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {randomAlphanumeric} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"

import {
    beginMcpConnect,
    createMcpEndpoint,
    deleteMcpEndpoint,
    discoverMcpConnect,
    editMcpEndpoint,
    probeMcpUrl,
} from "../api/api"
import {suggestConnectionName} from "../core/connectionName"
import {
    cancelDeletesEndpoint,
    journeyReducer,
    startJourney,
    startReconnect,
    type McpJourneyState,
} from "../core/connectJourney"
import {buildTrustedOrigins} from "../core/connectMessage"
import {watchOauthConsent} from "../core/connectWatch"
import {gatewayRefusalMessage, isNameTakenRefusal} from "../core/refusal"
import type {MCPAuthMode, MCPEndpoint} from "../core/types"
import {refreshMcpEndpointsAtom} from "../state/atoms"

export interface McpConnectJourneyOptions {
    /** Existing connections, for the name suggestion and the uniqueness check. */
    existingNames?: (string | null | undefined)[]
    /** Set when reconnecting an endpoint that already exists. */
    reconnect?: {id: string; slug: string; name: string; url: string} | null
    /** Called once the connection is real, with the slug agents reference it by. */
    onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
}

const AUTH_MODE_FOR_PROBE: Record<string, MCPAuthMode> = {
    oauth: "oauth",
    none: "none",
    // Discovery was inconclusive. The row is created carrying no credential rather than
    // presuming a key, and moves to api_key only if the person supplies one.
    unknown: "none",
}

export function useMcpConnectJourney({
    existingNames = [],
    reconnect = null,
    onConnected,
}: McpConnectJourneyOptions = {}) {
    const projectId = useAtomValue(projectIdAtom) ?? undefined
    const refreshEndpoints = useSetAtom(refreshMcpEndpointsAtom)

    const [state, dispatch] = useReducer(
        journeyReducer,
        reconnect,
        (initial): McpJourneyState => (initial ? startReconnect(initial) : startJourney()),
    )

    const stopWatchRef = useRef<(() => void) | null>(null)
    const popupNameRef = useRef(`mcp_oauth_${randomAlphanumeric(6)}`)
    // The reducer's state is not readable from inside an async step that already started,
    // so the identity is mirrored here for the teardown and the callbacks.
    const endpointRef = useRef<{id: string; slug: string} | null>(
        reconnect ? {id: reconnect.id, slug: reconnect.slug} : null,
    )

    const stopWatch = useCallback(() => {
        stopWatchRef.current?.()
        stopWatchRef.current = null
    }, [])

    const setUrl = useCallback((url: string) => dispatch({type: "url_changed", url}), [])
    const setName = useCallback((name: string) => dispatch({type: "name_changed", name}), [])

    const submitUrl = useCallback(
        async (url: string) => {
            dispatch({type: "submit_url"})
            try {
                const response = await probeMcpUrl(url, projectId)
                const probe = response.probe
                if (!probe) throw new Error("The server could not be checked.")
                if (!probe.reachable) {
                    dispatch({
                        type: "probe_failed",
                        error: probe.problem?.message || "The server did not answer.",
                    })
                    return
                }
                dispatch({
                    type: "probe_succeeded",
                    probe,
                    suggestedName: suggestConnectionName({
                        serverName: probe.server_name,
                        url,
                        existingNames,
                    }),
                })
            } catch (error) {
                dispatch({
                    type: "probe_failed",
                    error: gatewayRefusalMessage(error) || "The server could not be checked.",
                })
            }
        },
        [existingNames, projectId],
    )

    /**
     * Read the permissions the authorization server offers for this endpoint.
     *
     * Re-read on every attempt rather than cached from the probe: a reconnect exists partly
     * to step up to scopes the server did not offer, or Agenta did not ask for, last time.
     */
    const discoverScopes = useCallback(
        async (endpointId: string) => {
            try {
                const result = await discoverMcpConnect(endpointId, projectId)
                dispatch({type: "scopes_discovered", scopes: result.scopes_offered ?? []})
            } catch (error) {
                dispatch({
                    type: "scopes_failed",
                    error:
                        gatewayRefusalMessage(error) ||
                        "Could not read this server's OAuth configuration.",
                })
            }
        },
        [projectId],
    )

    /** Point an already-open popup at the provider, or report that it was blocked. */
    const driveConsent = useCallback(
        async (popup: Window | null, endpointId: string, scopes: string[]) => {
            const result = await beginMcpConnect(endpointId, scopes, projectId)
            const redirectUrl = result.redirect_url
            if (!redirectUrl) throw new Error("No authorization URL returned.")

            if (!popup) {
                // Blocked. A same-tab redirect still completes the flow, and the callback
                // returns the person to where they were.
                window.location.assign(redirectUrl)
                return
            }
            popup.location.href = redirectUrl

            stopWatch()
            stopWatchRef.current = watchOauthConsent({
                popup,
                endpointId,
                // The callback page is served by the API, so its origin is the only one
                // that can legitimately post the completion.
                trustedOrigins: buildTrustedOrigins([getAgentaApiUrl()]),
                target: window,
                onConnected: () => dispatch({type: "consent_succeeded"}),
                onFailed: (error) =>
                    dispatch(
                        error.toLowerCase().includes("closed")
                            ? {type: "consent_cancelled", error}
                            : {type: "consent_failed", error},
                    ),
            })
        },
        [projectId, stopWatch],
    )

    /** Commit the name and take whichever authentication path the probe established. */
    const submitName = useCallback(async () => {
        dispatch({type: "submit_name"})
        const probe = state.probe
        const mode = AUTH_MODE_FOR_PROBE[probe?.auth.mode ?? "unknown"] ?? "none"

        try {
            let endpointId = endpointRef.current?.id
            let slug = endpointRef.current?.slug

            if (!endpointId) {
                // No slug is sent: the API derives one from the name and hands it back,
                // and that returned slug is what agents reference.
                const created = await createMcpEndpoint(
                    {
                        name: state.name.trim(),
                        auth_mode: mode,
                        data: {route: {base_url: state.url.trim()}},
                    },
                    projectId,
                )
                const endpoint = created.endpoint
                if (!endpoint?.id || !endpoint.slug) {
                    throw new Error("The server did not return the created connection.")
                }
                endpointId = endpoint.id
                slug = endpoint.slug
                endpointRef.current = {id: endpointId, slug}
            }

            dispatch({type: "endpoint_created", endpointId, slug: slug as string})

            if (probe?.auth.mode === "oauth") {
                await discoverScopes(endpointId)
                return
            }

            if (probe?.auth.mode === "none") {
                dispatch({type: "verify_started"})
                dispatch({type: "verify_succeeded"})
            }
        } catch (error) {
            const refusal = gatewayRefusalMessage(error) || "The connection could not be saved."
            // A taken name is the one create failure the person can fix where they are
            // standing; everything else is a retry.
            dispatch(
                isNameTakenRefusal(error)
                    ? {type: "name_taken", error: refusal}
                    : {type: "create_failed", error: refusal},
            )
        }
    }, [discoverScopes, projectId, state.name, state.probe, state.url])

    const toggleScope = useCallback((scope: string) => dispatch({type: "scope_toggled", scope}), [])

    /**
     * Confirm the scopes and go to the provider.
     *
     * `popup` must be opened by the caller, synchronously in the tap that called this.
     */
    const submitScopes = useCallback(
        async (popup: Window | null) => {
            const endpointId = endpointRef.current?.id
            if (!endpointId) return
            dispatch({type: "submit_scopes"})
            try {
                await driveConsent(popup, endpointId, state.scopesSelected)
            } catch (error) {
                popup?.close()
                dispatch({
                    type: "consent_failed",
                    error:
                        gatewayRefusalMessage(error) || "The authorization could not be started.",
                })
            }
        },
        [driveConsent, state.scopesSelected],
    )

    /** Start (or restart) scope discovery for the endpoint being connected. */
    const startScopeDiscovery = useCallback(async () => {
        const endpointId = endpointRef.current?.id
        if (endpointId) await discoverScopes(endpointId)
    }, [discoverScopes])

    /** The manual fallback: attach a project secret as a header, then verify. */
    const submitManualCredential = useCallback(
        async ({headerName, secretId}: {headerName: string; secretId: string}) => {
            const endpoint = endpointRef.current
            if (!endpoint) return
            dispatch({type: "verify_started"})
            try {
                await editMcpEndpoint(
                    {
                        id: endpoint.id,
                        name: state.name.trim(),
                        auth_mode: "api_key",
                        secret_id: secretId,
                        data: {
                            route: {
                                base_url: state.url.trim(),
                                credential_header: headerName || undefined,
                            },
                        },
                    },
                    projectId,
                )
                dispatch({type: "verify_succeeded"})
            } catch (error) {
                dispatch({
                    type: "verify_failed",
                    error: gatewayRefusalMessage(error) || "The credential could not be saved.",
                })
            }
        },
        [projectId, state.name, state.url],
    )

    /** Connect a server that turned out to need nothing. */
    const skipAuthentication = useCallback(() => {
        dispatch({type: "verify_started"})
        dispatch({type: "verify_succeeded"})
    }, [])

    /**
     * Credentials are persisted. Pick up what the server wrote and tell the caller.
     *
     * It refetches rather than writing: the callback stored the grant server-side, so the
     * list is the only place this client can learn the row's real state from.
     */
    const finish = useCallback(async () => {
        const endpoint = endpointRef.current
        if (!endpoint) return
        stopWatch()
        await refreshEndpoints()
        dispatch({type: "saved"})
        onConnected?.({id: endpoint.id, slug: endpoint.slug, name: state.name.trim()})
    }, [onConnected, refreshEndpoints, state.name, stopWatch])

    /**
     * Abandon the journey. Deletes the pending row it created, and nothing else: a
     * reconnect leaves the working connection exactly as it found it.
     */
    const cancel = useCallback(async () => {
        stopWatch()
        const endpoint = endpointRef.current
        if (cancelDeletesEndpoint(state) && endpoint) {
            endpointRef.current = null
            try {
                await deleteMcpEndpoint(endpoint.id, projectId)
            } catch {
                // The row is inactive and expirable, so a failed cleanup is not worth
                // blocking the person on.
            }
        }
    }, [projectId, state, stopWatch])

    const retry = useCallback(() => dispatch({type: "retry"}), [])
    const retryTools = useCallback(() => dispatch({type: "retry_tools"}), [])

    const popupName = popupNameRef.current
    const expectsConsent = state.probe?.auth.mode === "oauth"

    return useMemo(
        () => ({
            state,
            /** The window name to pre-open, and whether this server will need one at all. */
            popupName,
            expectsConsent,
            setUrl,
            submitUrl,
            setName,
            submitName,
            toggleScope,
            submitScopes,
            startScopeDiscovery,
            submitManualCredential,
            skipAuthentication,
            finish,
            cancel,
            retry,
            retryTools,
            stopWatch,
        }),
        [
            cancel,
            expectsConsent,
            finish,
            popupName,
            retry,
            retryTools,
            setName,
            setUrl,
            skipAuthentication,
            startScopeDiscovery,
            state,
            stopWatch,
            submitManualCredential,
            submitName,
            submitScopes,
            submitUrl,
            toggleScope,
        ],
    )
}

export type McpConnectJourney = ReturnType<typeof useMcpConnectJourney>
export type {MCPEndpoint}
