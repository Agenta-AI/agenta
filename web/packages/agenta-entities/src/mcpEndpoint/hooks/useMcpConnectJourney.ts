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
    listMcpTools,
    probeMcpUrl,
    queryMcpEndpoints,
} from "../api/api"
import {suggestConnectionName} from "../core/connectionName"
import {
    adoptableEndpoint,
    cancelDeletesEndpoint,
    journeyReducer,
    startJourney,
    startReconnect,
    type McpJourneyState,
} from "../core/connectJourney"
import {buildTrustedOrigins} from "../core/connectMessage"
import {watchOauthConsent} from "../core/connectWatch"
import {
    credentialRefusalStatus,
    gatewayRefusalMessage,
    gatewayRefusalStatus,
    isCredentialRefusal,
    isNameTakenRefusal,
} from "../core/refusal"
import {rememberMcpReturnPath} from "../core/returnPath"
import type {MCPAuthMode, MCPEndpoint, MCPRegisteredOAuthClient} from "../core/types"
import {refreshMcpEndpointsAtom} from "../state/atoms"

export interface McpConnectJourneyOptions {
    /** Existing connections, for the name suggestion and the uniqueness check. */
    existingNames?: (string | null | undefined)[]
    /** Set when reconnecting an endpoint that already exists. */
    reconnect?: {
        id: string
        slug: string
        name: string
        url: string
        authMode?: "oauth" | "api_key" | "none"
        /**
         * The header this connection's credential is already sent under.
         *
         * A key reconnect repairs a credential and changes nothing else (decisions 10 and
         * 34), so the field it asks about starts where the connection left it. Prefilling the
         * probe's default instead offered `Authorization` over a saved `X-Api-Key`, and a
         * person who accepted what was on screen broke a working connection.
         */
        credentialHeader?: string | null
    } | null
    /** Called once the connection is real, with the slug agents reference it by. */
    onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
}

/**
 * How long the URL check may run before the dialog stops waiting on it.
 *
 * The probe's own deadline is twice this, so this is the bound a person actually meets. It
 * exists because the check is the first thing anyone does here and a spinner with no end is
 * indistinguishable from a broken dialog; the address is kept and Try again re-runs it.
 */
export const PROBE_TIMEOUT_MS = 10_000

/**
 * What the probe says when its own deadline expires
 * (`api/oss/src/core/gateways/mcps/probe.py`). The bound above expires first, so it reports
 * the same condition in the same words rather than inventing a second sentence for it.
 */
const PROBE_TIMED_OUT_MESSAGE =
    "The server did not finish answering in time. It may be responding too slowly to be usable."

/** Marks the bound above expiring, so the catch can tell it from the server's own failures. */
class ProbeTimedOut extends Error {}

const AUTH_MODE_FOR_PROBE: Record<string, MCPAuthMode> = {
    oauth: "oauth",
    none: "none",
    // Discovery was inconclusive. The row is created carrying no credential rather than
    // presuming a key, and moves to api_key only if the person supplies one.
    unknown: "none",
}

/**
 * The row a refused create was refused by, when it is the same connection being made.
 *
 * Asked only after a name refusal on a RETRY, so the ordinary path costs nothing. A list
 * that cannot be read answers "nothing to adopt", which leaves the person with the refusal
 * they already had rather than a second failure on top of it.
 */
/**
 * One stored connection, read back whole.
 *
 * The edit route replaces the document rather than merging it, so anything writing to a row
 * has to send back everything the row already had. There is no route for a single endpoint,
 * so the project's list is read and the row picked out of it.
 */
const storedEndpointFrom = async (id: string, projectId?: string): Promise<MCPEndpoint | null> => {
    const response = await queryMcpEndpoints(projectId)
    return (response.endpoints ?? []).find((row) => row.id === id) ?? null
}

const findAdoptableEndpoint = async ({
    name,
    url,
    projectId,
}: {
    name: string
    url: string
    projectId?: string
}): Promise<{id: string; slug: string} | null> => {
    try {
        const response = await queryMcpEndpoints(projectId)
        const row = adoptableEndpoint(response.endpoints, {name, url})
        return row?.id && row.slug ? {id: row.id, slug: row.slug} : null
    } catch {
        return null
    }
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

    /**
     * Which attempt the journey is on.
     *
     * Every async step reads it before its await and checks it after, on the answer and on
     * the failure alike. A step that comes back to a bumped generation belongs to an attempt
     * nobody is waiting for any more: a cancel, or an unmount. Without it, work in flight
     * installed itself afterwards — a watch holding a listener, an interval and a three-minute
     * timeout on a dead attempt, or an endpoint row arriving after the cancel that was
     * supposed to delete it (D34). Two of the seven sites checked it and the rest did not,
     * which is how a stale probe or a stale tool list could still answer for a journey that
     * had moved on (D52).
     */
    const attemptRef = useRef(0)
    const stopWatchRef = useRef<(() => void) | null>(null)
    const popupNameRef = useRef(`mcp_oauth_${randomAlphanumeric(6)}`)
    // The reducer's state is not readable from inside an async step that already started,
    // so the identity is mirrored here for the teardown and the callbacks.
    const endpointRef = useRef<{id: string; slug: string} | null>(
        reconnect ? {id: reconnect.id, slug: reconnect.slug} : null,
    )
    /**
     * What a create in THIS journey may already have written, when it may have written
     * anything: the name and address it carried, or null.
     *
     * It separates "the name is taken by my own lost save" from "the name is taken by
     * somebody else's connection", and the two have opposite answers: the first continues
     * from that row, the second is refused. A create whose answer was lost fails without
     * one, so it is a failure with no answer behind it that makes a later conflict possibly
     * ours; a conflict with nothing behind it is another connection's, whatever address it
     * points at (round 6, D-R6-3).
     *
     * The name and the address rather than a flag, because a flag outlives what set it. A
     * lost save, then an edit to the name, then a conflict on the NEW name was adopted as
     * though it were the lost row: a connection somebody else owns, which the credential
     * submit then wrote over (round 4, D170). What was attempted is the only thing a later
     * conflict can be compared against, and editing either field abandons it.
     */
    const attemptedCreateRef = useRef<{name: string; url: string} | null>(null)

    /**
     * Whether the row this journey is holding is one it made, rather than one it was given.
     *
     * The same question `createdHere` answers on the state, kept here because the callbacks
     * that need it do not re-read the state: `submitManualCredential` is memoised on the
     * fields it sends, so the state it closes over predates the create it is asking about,
     * and reading `createdHere` there answered for the wrong moment.
     */
    const createdHereRef = useRef(false)

    /** Whatever was attempted is no longer what is being asked for. */
    const forgetAttemptedCreate = useCallback(() => {
        attemptedCreateRef.current = null
    }, [])

    const stopWatch = useCallback(() => {
        stopWatchRef.current?.()
        stopWatchRef.current = null
    }, [])

    /** Abandon whatever is in flight. Anything that returns after this is ignored. */
    const abandonAttempt = useCallback(() => {
        attemptRef.current += 1
        stopWatch()
    }, [stopWatch])

    /**
     * Whether the attempt a step started on is still the one the journey is on.
     *
     * Read before the await, checked after it, on both the answer and the failure: a step that
     * comes back to a bumped generation belongs to an attempt nobody is waiting for, and what
     * it has to say would land on top of whatever replaced it (D52).
     */
    const isCurrent = useCallback((attempt: number) => attemptRef.current === attempt, [])

    const setUrl = useCallback(
        (url: string) => {
            forgetAttemptedCreate()
            // A row was made for the address being left. Leaving it behind is what let the
            // next connect continue from it; deleting it is what `cancel` already does for a
            // pending row this journey created, and for the same reason (round 4, D111).
            if (url.trim() !== state.url.trim()) {
                const abandoned = endpointRef.current
                if (cancelDeletesEndpoint(state) && abandoned) {
                    endpointRef.current = null
                    void deleteMcpEndpoint(abandoned.id, projectId).catch(() => undefined)
                }
            }
            dispatch({type: "url_changed", url})
        },
        [forgetAttemptedCreate, projectId, state],
    )
    const setName = useCallback(
        (name: string) => {
            forgetAttemptedCreate()
            dispatch({type: "name_changed", name})
        },
        [forgetAttemptedCreate],
    )

    const submitUrl = useCallback(
        async (url: string) => {
            const attempt = attemptRef.current
            dispatch({type: "submit_url"})
            let bound: ReturnType<typeof setTimeout> | undefined
            try {
                const response = await Promise.race([
                    probeMcpUrl(url, projectId),
                    new Promise<never>((_, reject) => {
                        bound = setTimeout(() => reject(new ProbeTimedOut()), PROBE_TIMEOUT_MS)
                    }),
                ])
                if (!isCurrent(attempt)) return
                const probe = response.probe
                if (!probe) throw new Error("The server could not be checked.")
                if (!probe.reachable) {
                    // The probe travels with the refusal: its `problem.cause` is what tells
                    // "could not reach it" from "reached it, and it is not an MCP server",
                    // which are different sentences and different advice.
                    dispatch({
                        type: "probe_failed",
                        probe,
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
                if (!isCurrent(attempt)) return
                if (error instanceof ProbeTimedOut) {
                    dispatch({type: "probe_failed", error: PROBE_TIMED_OUT_MESSAGE})
                    return
                }
                dispatch({
                    type: "probe_failed",
                    error: gatewayRefusalMessage(error) || "The server could not be checked.",
                })
            } finally {
                if (bound !== undefined) clearTimeout(bound)
            }
        },
        [existingNames, isCurrent, projectId],
    )

    /**
     * Read the permissions the authorization server offers for this endpoint.
     *
     * Re-read on every attempt rather than cached from the probe: a reconnect exists partly
     * to step up to scopes the server did not offer, or Agenta did not ask for, last time.
     */
    const discoverScopes = useCallback(
        async (endpointId: string) => {
            const attempt = attemptRef.current
            try {
                const result = await discoverMcpConnect(endpointId, projectId)
                if (!isCurrent(attempt)) return
                dispatch({type: "scopes_discovered", scopes: result.scopes_offered ?? []})
            } catch (error) {
                if (!isCurrent(attempt)) return
                dispatch({
                    type: "scopes_failed",
                    error:
                        gatewayRefusalMessage(error) ||
                        "Could not read this server's OAuth configuration.",
                })
            }
        },
        [isCurrent, projectId],
    )

    /** Point an already-open popup at the provider, or report that it was blocked. */
    const driveConsent = useCallback(
        async (
            popup: Window | null,
            endpointId: string,
            scopes: string[],
            oauthClient?: MCPRegisteredOAuthClient,
        ) => {
            const attempt = attemptRef.current
            const result = await beginMcpConnect(endpointId, scopes, projectId, oauthClient)

            if (!isCurrent(attempt)) {
                // The dialog closed while the authorization URL was being minted. Installing
                // the watch now would hold a listener, an interval and a timeout on an
                // attempt nobody is waiting for, which is the window OR67's own teardown
                // cannot cover because there is nothing installed yet to tear down.
                popup?.close()
                return
            }
            const redirectUrl = result.redirect_url
            if (!redirectUrl) throw new Error("No authorization URL returned.")

            if (!popup) {
                // Blocked, which mobile browsers and in-app webviews do far more readily than
                // desktop. The same-tab redirect still completes the authorization, but it
                // destroys this app and the journey with it, so the callback page sends the
                // tab back to the connections list rather than leaving it on the API's origin
                // under a message about closing itself. Anything unsaved elsewhere is lost;
                // that is the cost of the popup being refused, not of this branch.
                //
                // Where to come back to is written down HERE, because this is the last moment
                // anything knows it: the callback page knows the deployment's origin and not
                // which surface, workspace or project the person was in (r3-D1).
                rememberMcpReturnPath()
                window.location.assign(redirectUrl)
                return
            }
            // The watch goes on BEFORE the popup is pointed anywhere. A provider that answers
            // without a consent screen — the mock does, and a provider that already holds a
            // grant does too — can be back at the callback before the next statements run, and
            // the completion it posts then arrives at a window with no listener on it. Nothing
            // recovers from that: the poll only notices a CLOSED popup, which is a failure, so
            // a missed success waits out the three-minute timeout with the connection already
            // authorized behind it.
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

            popup.location.href = redirectUrl
        },
        [isCurrent, projectId, stopWatch],
    )

    /** Commit the name and take whichever authentication path the probe established. */
    const submitName = useCallback(async () => {
        dispatch({type: "submit_name"})
        const probe = state.probe
        const mode = AUTH_MODE_FOR_PROBE[probe?.auth.mode ?? "unknown"] ?? "none"

        const attempt = attemptRef.current
        /** Continue from a row, however this journey came by it. */
        const continueFrom = (row: {id: string; slug: string}, adopted?: boolean) => {
            createdHereRef.current =
                createdHereRef.current || (!endpointRef.current && !adopted && !reconnect)
            endpointRef.current = row
            // This transition already moves an OAuth connection to `discovering_scopes`, and
            // the component's effect owns that state. Awaiting discovery here as well ran it
            // twice per connect: two outbound round trips, and two full-row writes on a route
            // that writes back the snapshot it read (D31).
            dispatch({type: "endpoint_created", endpointId: row.id, slug: row.slug, adopted})
            if (probe?.auth.mode === "none") {
                dispatch({type: "verify_started"})
                dispatch({type: "verify_succeeded"})
            }
        }
        try {
            const existing = endpointRef.current
            if (existing) {
                continueFrom(existing)
                return
            }

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

            if (!isCurrent(attempt)) {
                // Cancelled while the create was in flight. The cancel found no row to
                // delete, so this one would be left behind; delete it here instead.
                void deleteMcpEndpoint(endpoint.id, projectId).catch(() => undefined)
                return
            }
            continueFrom({id: endpoint.id, slug: endpoint.slug})
        } catch (error) {
            if (!isCurrent(attempt)) return

            const attempted = {name: state.name.trim(), url: state.url.trim()}
            if (!isNameTakenRefusal(error)) {
                // Only a failure nothing answered leaves the question open. A status is the
                // server's answer that it did NOT write the row, so a later conflict cannot
                // be this attempt's (round 4, D170).
                attemptedCreateRef.current = gatewayRefusalStatus(error) === null ? attempted : null
            } else if (
                attemptedCreateRef.current?.name === attempted.name &&
                attemptedCreateRef.current?.url === attempted.url
            ) {
                // A create whose response was lost still landed. The retry creates again, the
                // API refuses the name, and the person is told to rename a connection they
                // already have while the half-finished row sits behind the dialog (round 4,
                // D3). So ask whether the row this name belongs to IS the one being made.
                const adopted = await findAdoptableEndpoint({
                    name: state.name.trim(),
                    url: state.url.trim(),
                    projectId,
                })
                if (!isCurrent(attempt)) return
                if (adopted) {
                    continueFrom(adopted, true)
                    return
                }
            }

            const refusal = gatewayRefusalMessage(error) || "The connection could not be saved."
            // A taken name is the one create failure the person can fix where they are
            // standing; everything else is a retry.
            dispatch(
                isNameTakenRefusal(error)
                    ? {type: "name_taken", error: refusal}
                    : {type: "create_failed", error: refusal},
            )
        }
    }, [projectId, state.name, state.probe, state.url])

    const toggleScope = useCallback((scope: string) => dispatch({type: "scope_toggled", scope}), [])

    /**
     * Confirm the scopes and go to the provider.
     *
     * `popup` must be opened by the caller, synchronously in the tap that called this.
     */
    const submitScopes = useCallback(
        async (popup: Window | null, oauthClient?: MCPRegisteredOAuthClient) => {
            const endpointId = endpointRef.current?.id
            if (!endpointId) return
            dispatch({type: "submit_scopes"})
            const attempt = attemptRef.current
            try {
                await driveConsent(popup, endpointId, state.scopesSelected, oauthClient)
            } catch (error) {
                popup?.close()
                if (!isCurrent(attempt)) return
                dispatch({
                    type: "consent_failed",
                    error:
                        gatewayRefusalMessage(error) || "The authorization could not be started.",
                })
            }
        },
        [driveConsent, isCurrent, state.scopesSelected],
    )

    /** Start (or restart) scope discovery for the endpoint being connected. */
    const startScopeDiscovery = useCallback(async () => {
        const endpointId = endpointRef.current?.id
        if (endpointId) await discoverScopes(endpointId)
    }, [discoverScopes])

    const storedEndpoint = useCallback(
        (id: string) => storedEndpointFrom(id, projectId),
        [projectId],
    )

    /** The manual fallback: attach a project secret as a header, then verify. */
    const submitManualCredential = useCallback(
        async ({headerName, secretId}: {headerName: string; secretId: string}) => {
            const endpoint = endpointRef.current
            if (!endpoint) return
            const attempt = attemptRef.current
            dispatch({type: "verify_started"})

            /** What a failure that was never about the credential lands on. */
            const reportCheckFailed = (error: unknown, fallback: string) =>
                dispatch({
                    type: "probe_failed",
                    probe: state.probe,
                    error: gatewayRefusalMessage(error) || fallback,
                })

            // Our own API first: read the row back, then write the credential onto it. A
            // failure here is ours, whatever status it carries. A session that expired made
            // this read answer 401, and classified as the relay's it read as the server
            // rejecting a key it had never been shown (round 4, D184).
            try {
                // The edit route writes what it is given rather than merging, so the whole
                // document goes back with only the credential changed. Sending the four
                // fields this step knows about dropped everything else the row carried, and
                // one of those is the per-connection tool filter, which is the gateway's only
                // enforcement point: a reconnect quietly widened what the server may run
                // (round 4, D114). `McpConnectionDetail`'s rename already honours this.
                const stored = await storedEndpoint(endpoint.id)
                // Read BEFORE the write, not only after the verification. This read is a
                // round trip, and a reconnect abandoned while it was in flight went on to
                // write a credential and verify it against a connection nobody was looking
                // at any more (round 4, D181).
                if (!isCurrent(attempt)) return
                if (!stored) {
                    reportCheckFailed(
                        null,
                        "This connection could not be read back, so nothing was changed. Try again.",
                    )
                    return
                }
                await editMcpEndpoint(
                    {
                        ...stored,
                        id: endpoint.id,
                        name: state.name.trim(),
                        auth_mode: "api_key",
                        secret_id: secretId,
                        // The stored flag describes the secret being replaced, so carrying
                        // it back marked a repaired connection as still needing input: the
                        // row went on reading "Login expired" after a successful swap
                        // (round 4, D180). The backend marks it false again by itself if
                        // the new secret fails, and the verification below is the call that
                        // would do it.
                        flags: {...stored.flags, is_valid: true},
                        data: {
                            ...stored.data,
                            route: {
                                ...stored.data?.route,
                                base_url: state.url.trim(),
                                credential_header: headerName || undefined,
                            },
                        },
                    },
                    projectId,
                )
            } catch (error) {
                if (!isCurrent(attempt)) return
                reportCheckFailed(error, "The connection could not be saved. Try again.")
                return
            }

            // And now the relay, which is the only call in this submit that can carry the
            // chosen server's answer about the credential.
            //
            // Saving a reference to a secret proves nothing about the secret. The step is
            // called Verify and the person is told "Verifying…", so it has to ask the
            // server: one authenticated handshake through the gateway, which injects the
            // credential and surfaces the upstream's refusal if it is the wrong one.
            // Without this a wrong header name or secret reads as connected until an
            // agent run fails, which is a long way from here.
            try {
                await listMcpTools(endpoint.slug, projectId)
                if (!isCurrent(attempt)) return
                dispatch({type: "verify_succeeded"})
            } catch (error) {
                if (!isCurrent(attempt)) return
                if (!isCredentialRefusal(error)) {
                    // Nothing answered about the credential, so nothing may say it was
                    // rejected. This is the check failing, which is the screen the design
                    // draws for a server that did not answer (round 4, D133 reopened).
                    reportCheckFailed(error, "The server could not be reached to check that key.")
                    return
                }
                const abandoned = endpointRef.current
                const discardedRow = createdHereRef.current && !!abandoned
                if (discardedRow && abandoned) {
                    endpointRef.current = null
                    createdHereRef.current = false
                    await deleteMcpEndpoint(abandoned.id, projectId).catch(() => undefined)
                }
                dispatch({
                    type: "verify_failed",
                    status: credentialRefusalStatus(error),
                    error:
                        gatewayRefusalMessage(error) ||
                        "The server did not accept that credential.",
                    discardedRow,
                })
            }
        },
        [isCurrent, projectId, state.name, state.probe, state.url, storedEndpoint],
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
        const attempt = attemptRef.current
        stopWatch()
        await refreshEndpoints()
        // The grant is stored either way, so nothing is lost by saying nothing: the connection
        // is in settings. Telling a form that was abandoned mid-refresh to select it would be
        // the one outcome nobody asked for.
        if (!isCurrent(attempt)) return
        dispatch({type: "saved"})
        onConnected?.({id: endpoint.id, slug: endpoint.slug, name: state.name.trim()})
    }, [isCurrent, onConnected, refreshEndpoints, state.name, stopWatch])

    /**
     * Abandon the journey. Deletes the pending row it created, and nothing else: a
     * reconnect leaves the working connection exactly as it found it.
     */
    const cancel = useCallback(async () => {
        abandonAttempt()
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
    }, [abandonAttempt, projectId, state])

    /**
     * Give up on one authorization attempt without giving up on the connection.
     *
     * The row stays: it is inert until a grant lands on it, and the next attempt continues
     * from it rather than making a second one. Whatever is in flight is disowned first, so a
     * consent that arrives after this cannot install itself on a screen that moved on.
     */
    const cancelConsent = useCallback(() => {
        abandonAttempt()
        dispatch({type: "consent_abandoned"})
    }, [abandonAttempt])

    const retry = useCallback(() => dispatch({type: "retry"}), [])
    const chooseManualAuth = useCallback(() => dispatch({type: "choose_manual_auth"}), [])

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
            cancelConsent,
            retry,
            chooseManualAuth,
            abandonAttempt,
        }),
        [
            abandonAttempt,
            cancel,
            cancelConsent,
            chooseManualAuth,
            expectsConsent,
            finish,
            popupName,
            retry,
            setName,
            setUrl,
            skipAuthentication,
            startScopeDiscovery,
            state,
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
