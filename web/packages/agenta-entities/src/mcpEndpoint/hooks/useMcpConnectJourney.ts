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
import {useCallback, useEffect, useMemo, useReducer, useRef} from "react"

import {getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {randomAlphanumeric} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"

import {
    beginMcpConnect,
    cancelMcpConnectAttempt,
    createMcpEndpoint,
    deleteMcpEndpoint,
    discoverMcpConnect,
    editMcpEndpoint,
    fetchMcpConnectAttempt,
    listMcpTools,
    probeMcpUrl,
    queryMcpEndpoints,
} from "../api/api"
import {suggestConnectionName} from "../core/connectionName"
import type {McpReconnectTarget} from "../core/connectionState"
import {
    adoptableEndpoint,
    cancelDeletesEndpoint,
    detectedAuthMode,
    journeyReducer,
    oauthConfigFrom,
    startJourney,
    startReconnect,
    type McpJourneyState,
} from "../core/connectJourney"
import {buildTrustedOrigins} from "../core/connectMessage"
import {watchOauthConsent} from "../core/connectWatch"
import {
    hasUrlSecretPlaceholder,
    normalizeCredentialBinding,
    withoutCredentialParameter,
} from "../core/credentialBinding"
import {
    credentialRefusalStatus,
    gatewayRefusalMessage,
    gatewayRefusalStatus,
    isCredentialRefusal,
    isNameTakenRefusal,
} from "../core/refusal"
import {rememberMcpReturnPath} from "../core/returnPath"
import type {
    MCPAuthMode,
    MCPCredentialBinding,
    MCPEndpoint,
    MCPOAuthConfig,
    MCPTokenEndpointAuthMethod,
} from "../core/types"
import {refreshMcpEndpointsAtom} from "../state/atoms"

export interface McpConnectJourneyOptions {
    /** Existing connections, for the name suggestion and the uniqueness check. */
    existingNames?: (string | null | undefined)[]
    /** Set when reconnecting an endpoint that already exists. */
    reconnect?: McpReconnectTarget | null
    /** Called once the connection is real, with the slug agents reference it by. */
    onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
}

/**
 * How long the URL check may run before the dialog stops waiting on it.
 *
 * Just above the probe's own deadline (`_DEADLINE_SECONDS` in
 * `api/oss/src/core/gateways/mcps/probe.py`, 20 s), so a slow server is reported by the API
 * in its own words, and this bound only meets an API that did not answer at all. It exists
 * because a spinner with no end is indistinguishable from a broken dialog; the address is
 * kept and Try again re-runs it.
 */
export const PROBE_TIMEOUT_MS = 22_000

/**
 * What the probe says when its own deadline expires
 * (`api/oss/src/core/gateways/mcps/probe.py`). When the bound above expires instead, it
 * reports the same condition in the same words rather than inventing a second sentence.
 */
const PROBE_TIMED_OUT_MESSAGE =
    "The server did not finish answering in time. It may be responding too slowly to be usable."

/** Marks the bound above expiring, so the catch can tell it from the server's own failures. */
class ProbeTimedOut extends Error {}

/** The probe, raced against the bound above. */
const probeWithin = async (
    url: string,
    projectId?: string,
    secretId?: string,
    binding?: MCPCredentialBinding,
) => {
    let bound: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            probeMcpUrl(url, projectId, secretId, binding),
            new Promise<never>((_, reject) => {
                bound = setTimeout(() => reject(new ProbeTimedOut()), PROBE_TIMEOUT_MS)
            }),
        ])
    } finally {
        if (bound !== undefined) clearTimeout(bound)
    }
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

/** Whether two OAuth settings would sign in the same way and ask for the same scopes. */
const sameOauthConfig = (
    a: MCPOAuthConfig | null | undefined,
    b: MCPOAuthConfig | null | undefined,
): boolean => {
    const key = (config: MCPOAuthConfig | null | undefined) =>
        JSON.stringify([
            config?.client_id ?? null,
            config?.client_secret_id ?? null,
            config?.token_endpoint_auth_method ?? null,
            [...(config?.scopes ?? [])].sort(),
        ])
    return key(a) === key(b)
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
    // The server-side consent attempt still waiting on a callback, so leaving the journey can
    // cancel it rather than let a late callback bind a grant nobody is waiting for.
    const consentAttemptRef = useRef<{endpointId: string; attemptId: string} | null>(null)
    const popupNameRef = useRef(`mcp_oauth_${randomAlphanumeric(6)}`)
    // The reducer's state is not readable from inside an async step that already started,
    // so the identity is mirrored here for the teardown and the callbacks.
    const endpointRef = useRef<{id: string; slug: string} | null>(
        reconnect ? {id: reconnect.id, slug: reconnect.slug} : null,
    )
    // The OAuth settings the row is known to hold, so a consent that changes nothing
    // writes nothing.
    const savedOauthConfigRef = useRef<{endpointId: string; config: MCPOAuthConfig} | null>(null)
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

    const reconnecting = !!reconnect
    const reconnectUrl = reconnect?.url

    /**
     * The mode the server or the saved row suggested. Choosing None over it is a claim the
     * server has not confirmed, so it is checked before the connection is called working.
     * A reconnect's check of its saved address is the server's answer, so it wins over the
     * saved row.
     */
    const serverProbe = state.probe ?? state.savedUrlProbe
    const suggestedAuthMode = serverProbe
        ? detectedAuthMode(serverProbe)
        : (reconnect?.authMode ?? "api_key")
    const mustVerifyNone = state.authMode === "none" && suggestedAuthMode !== "none"

    /** Whatever was attempted is no longer what is being asked for. */
    const forgetAttemptedCreate = useCallback(() => {
        attemptedCreateRef.current = null
    }, [])

    const stopWatch = useCallback(() => {
        stopWatchRef.current?.()
        stopWatchRef.current = null
    }, [])

    /** Cancel one server-side consent attempt. A failed cancel expires on its own. */
    const cancelServerAttempt = useCallback(
        (endpointId: string, attemptId: string) => {
            void cancelMcpConnectAttempt(endpointId, attemptId, projectId).catch(() => undefined)
        },
        [projectId],
    )

    /** Cancel the server's pending consent attempt, if there is one. */
    const cancelConsentAttempt = useCallback(() => {
        const pending = consentAttemptRef.current
        consentAttemptRef.current = null
        if (pending) cancelServerAttempt(pending.endpointId, pending.attemptId)
    }, [cancelServerAttempt])

    /** Abandon whatever is in flight. Anything that returns after this is ignored. */
    const abandonAttempt = useCallback(() => {
        attemptRef.current += 1
        stopWatch()
        cancelConsentAttempt()
    }, [cancelConsentAttempt, stopWatch])

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
    /**
     * Choose how the connection authenticates. The probe only suggested it.
     *
     * A first connect drops the pending row made in the old mode, as an address change does,
     * so the next press creates one in the new mode. A reconnect keeps its row: the step that
     * writes the credential writes the mode.
     */
    const selectAuthMode = useCallback(
        (mode: MCPAuthMode) => {
            if (mode === state.authMode) return
            if (mode === "oauth" && !state.oauthOffered) return
            forgetAttemptedCreate()
            if (state.probe) {
                const abandoned = endpointRef.current
                if (cancelDeletesEndpoint(state) && abandoned) {
                    void deleteMcpEndpoint(abandoned.id, projectId).catch(() => undefined)
                }
                endpointRef.current = null
                createdHereRef.current = false
            }
            dispatch({type: "auth_mode_selected", mode})
        },
        [forgetAttemptedCreate, projectId, state],
    )
    /** Change the address from the key screen, staying on it. */
    const editUrl = useCallback(
        (url: string) => {
            forgetAttemptedCreate()
            dispatch({type: "url_edited", url})
        },
        [forgetAttemptedCreate],
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
            if (hasUrlSecretPlaceholder(url)) {
                // The API refuses to check this address without its key, so the key screen
                // asks for the secret first and its press checks the address with it.
                dispatch({
                    type: "url_secret_submitted",
                    suggestedName: suggestConnectionName({url, existingNames}),
                })
                return
            }
            const attempt = attemptRef.current
            dispatch({type: "submit_url"})
            try {
                const response = await probeWithin(url, projectId)
                if (!isCurrent(attempt)) return
                const probe = response.probe
                if (!probe) throw new Error("The server could not be checked.")
                // Every problem stops at the address except a challenge with no OAuth,
                // which is the key screen's case. A reachable address that is not an MCP
                // server is still no server to connect.
                if (probe.problem && probe.problem.cause !== "auth_undiscoverable") {
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
            }
        },
        [existingNames, isCurrent, projectId],
    )

    /**
     * Check an address with the chosen secret sent where `binding` says, in the path of an
     * address with `{secret}` when it says nothing. Answers whether the server took it; every
     * other answer is dispatched here.
     *
     * The browser names the secret and the API reads its value, so the value never leaves
     * the vault for the browser. A server that still asks for authorization refused the key,
     * which is the key screen's refusal, not the address screen's.
     */
    const checkWithSecret = useCallback(
        async (
            url: string,
            secretId: string,
            attempt: number,
            binding?: MCPCredentialBinding,
        ): Promise<boolean> => {
            try {
                const {probe} = await probeWithin(url, projectId, secretId, binding)
                if (!isCurrent(attempt)) return false
                if (!probe) throw new Error("The server could not be checked.")
                if (probe.problem && probe.problem.cause !== "auth_undiscoverable") {
                    dispatch({type: "probe_failed", probe, error: probe.problem.message})
                    return false
                }
                if (probe.auth.mode !== "none") {
                    dispatch({
                        type: "verify_failed",
                        status: probe.auth.challenge_status ?? null,
                        error: "",
                    })
                    return false
                }
                return true
            } catch (error) {
                if (!isCurrent(attempt)) return false
                // The API's refusal of the address or the secret. The person fixes either on
                // the key screen, so the refusal stays there.
                dispatch({
                    type: "create_failed",
                    error:
                        error instanceof ProbeTimedOut
                            ? PROBE_TIMED_OUT_MESSAGE
                            : gatewayRefusalMessage(error) || "The server could not be checked.",
                })
                return false
            }
        },
        [isCurrent, projectId],
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
        async (popup: Window | null, endpointId: string, scopes: string[]) => {
            const attempt = attemptRef.current
            // A new window replaces the last one, whose callback must not land after it.
            cancelConsentAttempt()
            const result = await beginMcpConnect(endpointId, scopes, projectId)

            if (!isCurrent(attempt)) {
                // The dialog closed while the authorization URL was being minted. Installing
                // the watch now would hold a listener, an interval and a timeout on an
                // attempt nobody is waiting for, which is the window OR67's own teardown
                // cannot cover because there is nothing installed yet to tear down. The
                // attempt it minted is cancelled for the same reason.
                popup?.close()
                if (result.attempt_id) cancelServerAttempt(endpointId, result.attempt_id)
                return
            }
            const redirectUrl = result.redirect_url
            const attemptId = result.attempt_id
            if (!redirectUrl || !attemptId || !result.expires_in) {
                throw new Error("No authorization URL returned.")
            }

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
            // the completion it posts then arrives at a window with no listener on it, and only
            // the completion check on close would recover it.
            consentAttemptRef.current = {endpointId, attemptId}
            stopWatch()
            stopWatchRef.current = watchOauthConsent({
                popup,
                attemptId,
                // The callback page is served by the API, so its origin is the only one
                // that can legitimately post the completion.
                trustedOrigins: buildTrustedOrigins([getAgentaApiUrl()]),
                target: window,
                checkOutcome: async () =>
                    (await fetchMcpConnectAttempt(endpointId, attemptId, projectId)).attempt ??
                    null,
                // The same lifetime the callback enforces, so neither side gives up first.
                timeoutMs: result.expires_in * 1000,
                onConnected: () => {
                    consentAttemptRef.current = null
                    dispatch({type: "consent_succeeded"})
                },
                onFailed: (error) =>
                    dispatch(
                        error.toLowerCase().includes("closed")
                            ? {type: "consent_cancelled", error}
                            : {type: "consent_failed", error},
                    ),
            })

            popup.location.href = redirectUrl
        },
        [cancelConsentAttempt, cancelServerAttempt, isCurrent, projectId, stopWatch],
    )

    /**
     * Ask the server, through the relay, whether the connection works as saved.
     *
     * One authenticated handshake through the gateway, which injects the credential, or none,
     * and surfaces the upstream's refusal. Without it a wrong key, or a server that wants one,
     * reads as connected until an agent run fails, which is a long way from here.
     */
    const verifyConnection = useCallback(
        async (endpoint: {id: string; slug: string}, attempt: number) => {
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
                    dispatch({
                        type: "probe_failed",
                        probe: state.probe,
                        error:
                            gatewayRefusalMessage(error) ||
                            "The server could not be reached to check that key.",
                    })
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
        [isCurrent, projectId, state.probe],
    )

    /**
     * Commit the name and take the authentication path the person chose.
     *
     * The key path passes its binding, so the first write already leaves out a query
     * parameter the binding fills: a pasted `?apiKey=...` never reaches the stored row. A url
     * binding also passes the chosen secret, because its address is checked with the key
     * before the row is made.
     */
    const submitName = useCallback(
        async (binding?: MCPCredentialBinding, secretId?: string) => {
            dispatch({type: "submit_name"})
            const mode = state.authMode
            const url = withoutCredentialParameter(state.url.trim(), binding)

            const attempt = attemptRef.current
            if (binding?.kind === "url" && secretId) {
                if (!(await checkWithSecret(url, secretId, attempt, binding))) return
            }
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
                if (mode !== "none") return
                dispatch({type: "verify_started"})
                // A server that answered the probe without a key needs no second asking.
                if (mustVerifyNone) void verifyConnection(row, attempt)
                else dispatch({type: "verify_succeeded"})
            }
            try {
                const existing = endpointRef.current
                if (existing) {
                    continueFrom(existing)
                    return
                }

                // No slug is sent: the API derives one from the name and hands it back,
                // and that returned slug is what agents reference.
                const oauthConfig = mode === "oauth" ? oauthConfigFrom(state) : null
                const created = await createMcpEndpoint(
                    {
                        name: state.name.trim(),
                        auth_mode: mode,
                        // The API refuses a `{secret}` address without the binding that fills
                        // it, so the binding goes with the first write.
                        data: {
                            route: {
                                base_url: url,
                                credential_binding: binding && normalizeCredentialBinding(binding),
                            },
                            oauth_config: oauthConfig,
                        },
                    },
                    projectId,
                )
                const endpoint = created.endpoint
                if (!endpoint?.id || !endpoint.slug) {
                    throw new Error("The server did not return the created connection.")
                }
                if (oauthConfig) {
                    savedOauthConfigRef.current = {endpointId: endpoint.id, config: oauthConfig}
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

                const attempted = {name: state.name.trim(), url}
                if (!isNameTakenRefusal(error)) {
                    // Only a failure nothing answered leaves the question open. A status is the
                    // server's answer that it did NOT write the row, so a later conflict cannot
                    // be this attempt's (round 4, D170).
                    attemptedCreateRef.current =
                        gatewayRefusalStatus(error) === null ? attempted : null
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
                        url,
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
        },
        [checkWithSecret, mustVerifyNone, projectId, state, verifyConnection],
    )

    const toggleScope = useCallback((scope: string) => dispatch({type: "scope_toggled", scope}), [])

    /** The OAuth app the person registered with the provider, as they type it. */
    const setOauthClient = useCallback(
        (client: {
            clientId?: string
            clientSecretId?: string | null
            authMethod?: MCPTokenEndpointAuthMethod
        }) => dispatch({type: "oauth_client_changed", ...client}),
        [],
    )

    /**
     * Save the OAuth settings on screen to the row before consent, where it holds others.
     *
     * Here rather than only at create, because the scopes are final only now and a retry
     * after a refused consent reuses the row with whatever the person changed. The row
     * the journey created or read is enough to tell; a write reads the row fresh, because
     * the edit route replaces the whole row.
     */
    const storeOauthClient = useCallback(
        async (endpointId: string, wanted: MCPOAuthConfig) => {
            const known = savedOauthConfigRef.current
            if (known && known.endpointId === endpointId && sameOauthConfig(known.config, wanted)) {
                return
            }
            const stored = await storedEndpointFrom(endpointId, projectId)
            if (!stored) {
                throw new Error(
                    "This connection could not be read back, so nothing was changed. Try again.",
                )
            }
            if (!sameOauthConfig(stored.data.oauth_config, wanted)) {
                await editMcpEndpoint(
                    {...stored, id: endpointId, data: {...stored.data, oauth_config: wanted}},
                    projectId,
                )
            }
            savedOauthConfigRef.current = {endpointId, config: wanted}
        },
        [projectId],
    )

    const submitScopes = useCallback(
        async (popup: Window | null) => {
            const endpointId = endpointRef.current?.id
            if (!endpointId) return
            dispatch({type: "submit_scopes"})
            const attempt = attemptRef.current
            try {
                await storeOauthClient(endpointId, oauthConfigFrom(state))
                if (!isCurrent(attempt)) {
                    popup?.close()
                    return
                }
                await driveConsent(popup, endpointId, state.scopesSelected)
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
        [driveConsent, isCurrent, state, storeOauthClient],
    )

    const storedEndpoint = useCallback(
        (id: string) => storedEndpointFrom(id, projectId),
        [projectId],
    )

    /**
     * Move a reconnected row to the mode chosen on the sheet, where it is not in it already.
     *
     * Through the full-replace edit, so the id, the slug and the tool filter stay. The bound
     * secret is let go, never deleted: a key belongs to the project's vault, not to the row.
     *
     * Answers the reason it failed, or null. The caller checks the attempt after it.
     */
    const storeAuthMode = useCallback(
        async (id: string, mode: MCPAuthMode, attempt: number): Promise<string | null> => {
            try {
                const stored = await storedEndpoint(id)
                // Before the write: a sheet closed while the read was in flight must leave
                // the working connection as it found it (round 4, D181).
                if (!isCurrent(attempt)) return null
                if (!stored) {
                    return "This connection could not be read back, so nothing was changed. Try again."
                }
                if (stored.auth_mode !== mode) {
                    await editMcpEndpoint(
                        {...stored, id, auth_mode: mode, secret_id: null},
                        projectId,
                    )
                }
                return null
            } catch (error) {
                return gatewayRefusalMessage(error) || "The connection could not be saved."
            }
        },
        [isCurrent, projectId, storedEndpoint],
    )

    /** Start (or restart) scope discovery for the endpoint being connected. */
    const startScopeDiscovery = useCallback(async () => {
        const endpointId = endpointRef.current?.id
        if (!endpointId) return
        if (reconnecting) {
            // The consent route refuses a row that is not OAuth, so a reconnect switching to
            // it writes the mode first.
            const attempt = attemptRef.current
            const failure = await storeAuthMode(endpointId, "oauth", attempt)
            if (!isCurrent(attempt)) return
            if (failure) {
                dispatch({type: "scopes_failed", error: failure})
                return
            }
        }
        await discoverScopes(endpointId)
    }, [discoverScopes, isCurrent, reconnecting, storeAuthMode])

    /** The manual fallback: attach a project secret where the binding says, then verify. */
    const submitManualCredential = useCallback(
        async ({binding, secretId}: {binding: MCPCredentialBinding; secretId: string}) => {
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

            const url = withoutCredentialParameter(state.url.trim(), binding)
            // A connection that already exists works with what it holds, so the new key is
            // checked first and written only if the server takes it, as a switch to None
            // is. Writing first left a refused key saved on a working connection.
            if (!createdHereRef.current) {
                const accepted = await checkWithSecret(
                    url,
                    secretId,
                    attempt,
                    normalizeCredentialBinding(binding),
                )
                if (!accepted) return
            }

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
                                base_url: url,
                                credential_binding: normalizeCredentialBinding(binding),
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
            // chosen server's answer about the credential. Saving a reference to a secret
            // proves nothing about the secret.
            await verifyConnection(endpoint, attempt)
        },
        [
            checkWithSecret,
            isCurrent,
            projectId,
            state.name,
            state.probe,
            state.url,
            storedEndpoint,
            verifyConnection,
        ],
    )

    /**
     * Ask the server for a handshake with no key. Answers whether it gave one; a refusal or
     * a failed check is dispatched here.
     */
    const checkWithoutKey = useCallback(
        async (url: string, attempt: number): Promise<boolean> => {
            let error: string
            try {
                const {probe} = await probeWithin(url, projectId)
                if (!isCurrent(attempt)) return false
                if (probe?.auth.mode === "none" && !probe.problem) return true
                if (probe?.reachable && probe.auth.mode !== "none") {
                    dispatch({
                        type: "verify_failed",
                        status: probe.auth.challenge_status ?? null,
                        error: "",
                    })
                    return false
                }
                error = probe?.problem?.message || "The server could not be checked."
            } catch (caught) {
                if (!isCurrent(attempt)) return false
                error =
                    caught instanceof ProbeTimedOut
                        ? PROBE_TIMED_OUT_MESSAGE
                        : gatewayRefusalMessage(caught) || "The server could not be checked."
            }
            // Not the fresh probe: a reconnect has none, and the screens read one as a first
            // connect.
            dispatch({type: "probe_failed", probe: state.probe, error})
            return false
        },
        [isCurrent, projectId, state.probe],
    )

    /**
     * Connect with no credential, writing the mode where a reconnect changed it, and asking
     * the server where None overrides what it or the saved row suggested.
     */
    const skipAuthentication = useCallback(async () => {
        dispatch({type: "verify_started"})
        const endpoint = endpointRef.current
        const attempt = attemptRef.current
        if (reconnecting && endpoint) {
            // Asked before the write. The relay's check runs on the saved row, so after the
            // write a refusal left the row on None with its key let go.
            if (mustVerifyNone && reconnectUrl) {
                if (!(await checkWithoutKey(reconnectUrl, attempt))) return
            }
            const failure = await storeAuthMode(endpoint.id, "none", attempt)
            if (!isCurrent(attempt)) return
            if (failure) {
                dispatch({type: "probe_failed", probe: state.probe, error: failure})
                return
            }
            dispatch({type: "verify_succeeded"})
            return
        }
        if (mustVerifyNone && endpoint) {
            await verifyConnection(endpoint, attempt)
            return
        }
        dispatch({type: "verify_succeeded"})
    }, [
        checkWithoutKey,
        isCurrent,
        mustVerifyNone,
        reconnectUrl,
        reconnecting,
        state.probe,
        storeAuthMode,
        verifyConnection,
    ])

    // A reconnect never asks for the address, but whether OAuth can be chosen depends on what
    // the server publishes, so its saved address is checked once in the background. The row,
    // its screen and its saved mode stay as they are.
    // An address with `{secret}` cannot be checked without its key, and it has no OAuth to
    // find either.
    useEffect(() => {
        if (!reconnectUrl || hasUrlSecretPlaceholder(reconnectUrl)) return
        let live = true
        Promise.resolve()
            .then(() => probeMcpUrl(reconnectUrl, projectId))
            .then((response) => {
                if (live && response?.probe) {
                    dispatch({type: "saved_url_probed", probe: response.probe})
                }
            })
            .catch(() => undefined)
        return () => {
            live = false
        }
    }, [projectId, reconnectUrl])

    // An OAuth reconnect reads back the OAuth settings its row is saved with, because the
    // hosts pass only the address and the mode. It cannot submit until they arrive, and a
    // read that fails says so rather than passing for a row with no settings.
    const reconnectId = reconnect?.authMode === "oauth" ? reconnect.id : null
    const savedConfigLoading = state.savedOauthConfig === "loading"
    useEffect(() => {
        if (!reconnectId || !savedConfigLoading) return
        let live = true
        storedEndpointFrom(reconnectId, projectId)
            .then((row) => {
                if (!live) return
                if (!row) {
                    dispatch({type: "oauth_client_load_failed"})
                    return
                }
                const config = row.data.oauth_config ?? null
                if (config) savedOauthConfigRef.current = {endpointId: reconnectId, config}
                dispatch({type: "oauth_client_loaded", config})
            })
            .catch(() => {
                if (live) dispatch({type: "oauth_client_load_failed"})
            })
        return () => {
            live = false
        }
    }, [projectId, reconnectId, savedConfigLoading])

    /** Read the saved OAuth settings again, after a read that failed. */
    const reloadSavedOauthConfig = useCallback(
        () => dispatch({type: "oauth_client_load_started"}),
        [],
    )

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

    const popupName = popupNameRef.current
    const expectsConsent = state.authMode === "oauth"

    return useMemo(
        () => ({
            state,
            /** The window name to pre-open, and whether this server will need one at all. */
            popupName,
            expectsConsent,
            setUrl,
            editUrl,
            submitUrl,
            setName,
            selectAuthMode,
            submitName,
            toggleScope,
            setOauthClient,
            reloadSavedOauthConfig,
            submitScopes,
            startScopeDiscovery,
            submitManualCredential,
            skipAuthentication,
            finish,
            cancel,
            cancelConsent,
            retry,
            abandonAttempt,
        }),
        [
            abandonAttempt,
            cancel,
            cancelConsent,
            editUrl,
            expectsConsent,
            finish,
            popupName,
            retry,
            selectAuthMode,
            setName,
            setUrl,
            skipAuthentication,
            startScopeDiscovery,
            state,
            submitManualCredential,
            submitName,
            submitScopes,
            submitUrl,
            setOauthClient,
            reloadSavedOauthConfig,
            toggleScope,
        ],
    )
}

export type McpConnectJourney = ReturnType<typeof useMcpConnectJourney>
export type {MCPEndpoint}
