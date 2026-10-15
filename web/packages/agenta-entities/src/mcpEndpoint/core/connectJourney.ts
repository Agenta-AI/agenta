/**
 * The one Connect journey, as a pure state machine.
 *
 * The old flow made a person register a server and then, as a separate action from a row
 * menu, connect it. That exposed an internal distinction — a row exists before a
 * credential does — as two user-facing steps. This keeps the distinction and hides it: the
 * journey still creates a row before consent, but the row is inert until authorization
 * succeeds and no surface shows it as a connection before then.
 *
 * It is a reducer with no React, no timers and no network in it, because the states worth
 * getting right are the ones nobody clicks through by hand: a cancelled consent, a second
 * submit, a popup that never returns, a consent that lands after the dialog moved on.
 *
 * Two invariants the transitions exist to hold:
 *
 * - Cancelling never destroys a working connection. Cancel during a first connect asks the
 *   caller to delete the pending row it just made; cancel during a reconnect asks for
 *   nothing, because the row was already someone's working server.
 * - A failure never reads as success. Every non-success path lands on a state that carries
 *   an explanation, and `isConnected` is true for exactly the states after credentials are
 *   persisted. Success itself is drawn nowhere: `connected` is where the journey stops and
 *   the caller's list, not this dialog, is what says so (decision 26).
 */
import {normalizeConnectionName} from "./connectionName"
import type {MCPAuthMode, MCPOAuthConfig, MCPServerProbe, MCPTokenEndpointAuthMethod} from "./types"

/**
 * The authentication a probe suggests, which is where the selector starts.
 *
 * Only a suggestion. A server that publishes OAuth metadata may also take a key, and one that
 * answered without a key may give more with one, so the person's choice is what the row is
 * created in. An inconclusive probe is, in practice, a server holding its tools behind a key
 * it would not describe.
 */
export const detectedAuthMode = (probe: MCPServerProbe): MCPAuthMode => {
    if (probe.auth.mode === "oauth") return "oauth"
    if (probe.auth.mode === "none") return "none"
    return "api_key"
}

/**
 * Whether the server signs in only clients registered with it by hand.
 *
 * The probe's answer for a server with no dynamic registration that takes no client ID
 * metadata document from this deployment either (GitHub, HubSpot, Asana). The OAuth screen
 * then asks for the person's own OAuth app.
 */
export const needsOwnOauthApp = (probe: MCPServerProbe | null | undefined): boolean =>
    probe?.auth.registration === "unavailable"

/** How an app the person entered authenticates, until they pick otherwise. */
export const DEFAULT_OAUTH_CLIENT_AUTH_METHOD: MCPTokenEndpointAuthMethod = "client_secret_post"

/**
 * The OAuth settings on screen, as the row stores them: the app the person entered, if
 * any, and the scopes they asked for. Saved and checked as one, so a method is never kept
 * for an app or a secret that is gone.
 */
export const oauthConfigFrom = (state: McpJourneyState): MCPOAuthConfig => {
    const clientId = state.oauthClientId.trim()
    const method = state.oauthClientAuthMethod ?? DEFAULT_OAUTH_CLIENT_AUTH_METHOD
    return {
        client_id: clientId || null,
        client_secret_id: clientId && method !== "none" ? state.oauthClientSecretId : null,
        token_endpoint_auth_method: clientId ? method : null,
        scopes: state.scopesSelected,
    }
}

/**
 * Whether the OAuth settings on screen can be saved: a server that registers no clients
 * needs an app, and an app that sends a secret needs one.
 */
export const oauthConfigReady = (state: McpJourneyState): boolean => {
    const config = oauthConfigFrom(state)
    if (!config.client_id) return !needsOwnOauthApp(state.probe ?? state.savedUrlProbe)
    return config.token_endpoint_auth_method === "none" || !!config.client_secret_id
}

/**
 * The scopes a server now offers, with the person's choices kept.
 *
 * A scope already on the list keeps its check, so a re-read after the person unchecked one
 * does not ask for it again. A scope new to the list is checked when the connection saved
 * no selection, or saved one that includes it: a reconnect asks for what was asked for
 * last time, and a first connect narrows what was offered rather than building a request
 * (D17).
 */
const withOfferedScopes = (state: McpJourneyState, offered: string[]) => ({
    scopesOffered: offered,
    scopesSelected: offered.filter((scope) =>
        state.scopesOffered.includes(scope)
            ? state.scopesSelected.includes(scope)
            : (state.scopesSaved?.includes(scope) ?? true),
    ),
})

/**
 * The address two rows are compared by: no trailing slash, no case, no surrounding space.
 *
 * Deliberately not a URL parse. What is being asked is "did this journey already write this
 * row", and an answer that depends on how a parser normalizes a port or a path would say yes
 * to two rows the person sees as different addresses.
 */
const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean => {
    const clean = (value: string | null | undefined) =>
        (value ?? "").trim().replace(/\/+$/, "").toLowerCase()
    const left = clean(a)
    return !!left && left === clean(b)
}

/**
 * The existing row a refused create was refused BY, when it is the same connection.
 *
 * A create can land server-side and lose its response. The retry then creates again, the API
 * refuses the name as taken, and the person is told to invent a second name for a connection
 * they already have — with the half-finished row left behind at "Needs authorization" and no
 * way forward (round 4, D3).
 *
 * The row is only offered back when its name AND its address both match what is being
 * connected. A name collision against a DIFFERENT server is a real collision and still has to
 * be refused: two connections to two servers cannot share one label, and silently continuing
 * into someone else's row would be worse than the dead end.
 */
export function adoptableEndpoint<
    T extends {id?: string | null; slug?: string | null; name?: string | null; data?: unknown},
>(endpoints: T[] | undefined, target: {name: string; url: string}): T | null {
    const wanted = normalizeConnectionName(target.name)
    if (!wanted) return null
    return (
        (endpoints ?? []).find((endpoint) => {
            if (!endpoint.id || !endpoint.slug) return false
            if (normalizeConnectionName(endpoint.name ?? "") !== wanted) return false
            const baseUrl = (endpoint.data as {route?: {base_url?: string | null}} | undefined)
                ?.route?.base_url
            return sameAddress(baseUrl, target.url)
        }) ?? null
    )
}

export type McpJourneyStatus =
    | "url_entry"
    | "checking_url"
    | "check_failed"
    | "naming"
    | "creating"
    | "create_failed"
    | "discovering_scopes"
    | "choosing_scopes"
    | "scopes_failed"
    | "awaiting_consent"
    | "consent_cancelled"
    | "consent_failed"
    | "manual_auth"
    | "verifying"
    | "verify_failed"
    | "saving"
    | "connected"

/**
 * What a server said about one of its tools, as `tools/list` returned it.
 *
 * The name is the tool's identity and the only spelling every harness and every saved policy
 * agrees on, so it is the key a permission is stored under and it is never replaced by a
 * prettier string. Everything else here is presentation or advice, kept because the server
 * offered it and because a reader that drops it forces the surfaces above to guess.
 *
 * `annotations` is the server's own advice about a tool, not a guarantee. `readOnlyHint` is
 * how the permission drawer separates reads from writes, and a tool that omits it is treated
 * as a write: the unknown case has to fall on the cautious side of that split.
 */
export interface McpToolAnnotations {
    /** The older spelling of the display title, from servers predating the top-level field. */
    title?: string
    /** The server's claim that the tool does not modify anything. Advice, not a guarantee. */
    readOnlyHint?: boolean
    /** The server's warning that the tool can destroy something it touches. */
    destructiveHint?: boolean
}

export interface McpToolSummary {
    name: string
    /** A human title the server prefers over `name`. Display only; never a key. */
    title?: string
    description?: string
    annotations?: McpToolAnnotations
    /**
     * The tool's argument schema, verbatim. Carried rather than parsed: nothing in this package
     * reads it, and a surface that wants to show a tool's inputs cannot recover it once dropped.
     */
    inputSchema?: unknown
}

/**
 * The string a surface shows for a tool.
 *
 * The precedence is the protocol's own: the top-level `title` added in 2025-06-18, then the
 * `annotations.title` older servers wrote, then the name. A tool with neither shows its name,
 * which is what every MCP surface showed before titles existed.
 */
export const mcpToolDisplayName = (tool: McpToolSummary): string =>
    tool.title?.trim() || tool.annotations?.title?.trim() || tool.name

export interface McpJourneyState {
    status: McpJourneyStatus
    /** Routing: the address the person typed. Retained across every failure and retry. */
    url: string
    /** Display metadata: the suggested or edited label. */
    name: string
    /** Once true, discovery may no longer improve the name. */
    nameTouched: boolean
    /** Protocol context: what the probe established about the server. */
    probe: MCPServerProbe | null
    /**
     * Protocol context: what a reconnect's check of its saved address found. Kept apart
     * from `probe`, which a reconnect never has, so the card and the None check read the
     * server's answer rather than the saved row's mode.
     */
    savedUrlProbe: MCPServerProbe | null
    /**
     * Policy: how the connection authenticates. The probe sets the first value; the person's
     * choice replaces it, and every transition and the row itself read this, never the probe.
     */
    authMode: MCPAuthMode
    /** Once true, a later probe of the same address may no longer change the choice. */
    authModeTouched: boolean
    /**
     * Whether OAuth can be chosen. Consent needs the server's authorization metadata, so it
     * is offered only where a probe of the address found it.
     */
    oauthOffered: boolean
    /** Protocol context: the permissions the authorization server offers. */
    scopesOffered: string[]
    /** Which of them this attempt asks for. A reconnect uses it to step up. */
    scopesSelected: string[]
    /**
     * Configuration: an OAuth app the person registered with the provider. Empty for the
     * usual case, where Agenta registers itself.
     */
    oauthClientId: string
    /** The project secret holding that app's secret. */
    oauthClientSecretId: string | null
    /** How that app authenticates at the token endpoint. Null until the person picks. */
    oauthClientAuthMethod: MCPTokenEndpointAuthMethod | null
    /** The scopes a reconnected row was saved with, or null for a row that saved none. */
    scopesSaved: string[] | null
    /**
     * Where an OAuth reconnect stands in reading back its saved settings. It cannot
     * submit until they have loaded: the fields would otherwise save as empty over them.
     * Null where there is nothing to read.
     */
    savedOauthConfig: "loading" | "loaded" | "failed" | null
    /** Identity, once the row exists. Null until then, and never regenerated after. */
    endpointId: string | null
    slug: string | null
    /**
     * Whether this journey created the row it is connecting. A reconnect did not, and must
     * not delete one on cancel.
     */
    createdHere: boolean
    /**
     * The status behind the current failure, where something answered.
     *
     * Read by the key screen, which names it: the specification's sentence is about the
     * request that carried the credential, and a number taken from any other request is a
     * confident false specific.
     */
    failureStatus: number | null
    error: string | null
}

export type McpJourneyEvent =
    | {type: "url_changed"; url: string}
    /**
     * The address, edited on the key screen to put `{secret}` where the key goes. Nothing
     * else changes: the screen, the choice and the probe stay, and the next press checks
     * the address with the secret.
     */
    | {type: "url_edited"; url: string}
    | {type: "submit_url"}
    /**
     * An address with `{secret}` was submitted. It does not exist without its key, so it is
     * not checked anonymously: the journey goes to the key screen, and the press there
     * checks it with the chosen secret.
     */
    | {type: "url_secret_submitted"; suggestedName: string}
    | {type: "probe_succeeded"; probe: MCPServerProbe; suggestedName: string}
    | {
          type: "probe_failed"
          error: string
          /**
           * What the probe answered, when it answered at all. The failure screen names the
           * cause ("couldn't reach" against "reached it, but it isn't an MCP server"), and
           * `problem.cause` is the only thing that tells those apart. A failure the probe
           * never returned from — a thrown refusal, a client-side timeout — carries none,
           * and the screen falls back to the unreachable wording.
           */
          probe?: MCPServerProbe | null
      }
    | {type: "name_changed"; name: string}
    | {type: "auth_mode_selected"; mode: MCPAuthMode}
    /**
     * A reconnect's check of its saved address, which says whether OAuth can be offered. It
     * changes nothing else: the reconnect keeps its row, its screen and its saved mode.
     */
    | {type: "saved_url_probed"; probe: MCPServerProbe}
    | {type: "submit_name"}
    | {
          type: "endpoint_created"
          endpointId: string
          slug: string
          /** The row already existed and this journey took it over, so it does not own it. */
          adopted?: boolean
      }
    | {type: "create_failed"; error: string}
    | {type: "name_taken"; error: string}
    | {type: "scopes_discovered"; scopes: string[]}
    | {type: "scopes_failed"; error: string}
    | {type: "scope_toggled"; scope: string}
    | {
          type: "oauth_client_changed"
          clientId?: string
          clientSecretId?: string | null
          authMethod?: MCPTokenEndpointAuthMethod
      }
    /** The OAuth app a reconnected row is saved with, read back after the sheet opened. */
    | {type: "oauth_client_loaded"; config: MCPOAuthConfig | null}
    | {type: "oauth_client_load_failed"}
    | {type: "oauth_client_load_started"}
    | {type: "submit_scopes"}
    | {type: "consent_started"}
    | {type: "consent_succeeded"}
    | {type: "consent_failed"; error: string}
    | {type: "consent_cancelled"; error: string}
    | {type: "choose_manual_auth"}
    | {type: "verify_started"}
    | {type: "verify_succeeded"}
    | {
          type: "verify_failed"
          error: string
          /**
           * The status the server answered the credentialed request with. Only 401 and 403
           * reach this event; anything else is a failure to check the key rather than a
           * verdict on it, and its caller routes it to the check's own failure screen
           * (round 4, D133 reopened).
           */
          status?: number | null
          /**
           * The pending row this journey made was removed with the refusal.
           *
           * A credential the server refused leaves a row carrying a secret that does not
           * work, and the registry has no health field to say so, so it read as Connected
           * (decision 30). The journey takes it away again rather than leaving a connection
           * that reports itself working; the identity goes with it, and a retry creates a
           * fresh row (round 6d, live).
           */
          discardedRow?: boolean
      }
    | {type: "saved"}
    | {type: "consent_abandoned"}
    | {type: "retry"}

/** Start a first connection. */
export function startJourney(): McpJourneyState {
    return {
        status: "url_entry",
        url: "",
        name: "",
        nameTouched: false,
        probe: null,
        savedUrlProbe: null,
        authMode: "none",
        authModeTouched: false,
        oauthOffered: false,
        scopesOffered: [],
        scopesSelected: [],
        oauthClientId: "",
        oauthClientSecretId: null,
        oauthClientAuthMethod: null,
        scopesSaved: null,
        savedOauthConfig: null,
        endpointId: null,
        slug: null,
        createdHere: false,
        failureStatus: null,
        error: null,
    }
}

/**
 * Start a reconnect of an endpoint that already exists.
 *
 * It enters at scope discovery rather than at the URL, because nothing about the server is
 * being chosen: the address, the label and the identity are already this connection's, and
 * the only thing missing is a credential. The scope list is re-read rather than assumed, so
 * a server that has started offering more can be stepped up to on the way back.
 */
export function startReconnect(endpoint: {
    id: string
    slug: string
    name: string
    url: string
    /** How the connection authorizes. A reconnect repairs whichever it is. */
    authMode?: MCPAuthMode
}): McpJourneyState {
    const authMode = endpoint.authMode ?? "api_key"
    return {
        ...startJourney(),
        // Only an OAuth connection has scopes to re-read. A key-authenticated one is repaired
        // by supplying the credential again, and sending it to scope discovery instead just
        // earns the route's refusal that it is not an OAuth target.
        status: authMode === "oauth" ? "discovering_scopes" : "manual_auth",
        url: endpoint.url,
        authMode,
        // Until its address is checked, a connection saved with OAuth is known to have it.
        oauthOffered: authMode === "oauth",
        savedOauthConfig: authMode === "oauth" ? "loading" : null,
        name: endpoint.name,
        nameTouched: true,
        endpointId: endpoint.id,
        slug: endpoint.slug,
        createdHere: false,
    }
}

/** The states in which credentials are persisted and the connection is real. */
const CONNECTED_STATES: ReadonlySet<McpJourneyStatus> = new Set([
    // `saving` counts as connected because the credential exchange already happened, in the
    // callback, server-side. From here the grant exists whatever this dialog does next, so a
    // cancel that deleted the row would orphan a live grant at the provider (D29).
    "saving",
    "connected",
])

export const isConnected = (state: McpJourneyState): boolean => CONNECTED_STATES.has(state.status)

/** The states that are waiting on something and should show progress. */
const BUSY_STATES: ReadonlySet<McpJourneyStatus> = new Set([
    "checking_url",
    "creating",
    "discovering_scopes",
    "awaiting_consent",
    "verifying",
    "saving",
])

export const isBusy = (state: McpJourneyState): boolean => BUSY_STATES.has(state.status)

/**
 * Whether cancelling now should delete the pending row.
 *
 * True only for a row this journey created and has not yet connected. A reconnect, and a
 * journey that has already succeeded, both answer false.
 */
export const cancelDeletesEndpoint = (state: McpJourneyState): boolean =>
    state.createdHere && !!state.endpointId && !isConnected(state)

/**
 * Where a `retry` goes from each recoverable failure.
 *
 * Only failures whose target state has a driver. `creating` and `verifying` are busy states
 * that nothing re-invokes, so sending a retry there replaced the error with a permanent
 * spinner and disabled both buttons (D30); those two are retried by calling the operation
 * again, the way `check_failed` always was.
 */
const RETRY_TARGET: Partial<Record<McpJourneyStatus, McpJourneyStatus>> = {
    check_failed: "checking_url",
    scopes_failed: "discovering_scopes",
    // Back to the checklist, on the SAME pending row: retrying must not make a second
    // connection, and the scopes are the likeliest thing to change after a refusal.
    consent_cancelled: "choosing_scopes",
    consent_failed: "choosing_scopes",
}

export function journeyReducer(state: McpJourneyState, event: McpJourneyEvent): McpJourneyState {
    switch (event.type) {
        case "url_changed": {
            // Editing the address invalidates what the last probe said about it, and the row
            // that was made for it. The row kept its identity here, so a person who connected
            // one address, went back, and typed another had the second connect continue from
            // the FIRST address's row: the connection they were told they made pointed
            // somewhere they had left behind (round 4, D111). The caller deletes the row it
            // is still holding; this forgets it.
            const sameAddress = event.url.trim() === state.url.trim()
            return {
                ...state,
                status: "url_entry",
                url: event.url,
                probe: null,
                oauthOffered: false,
                error: null,
                // A choice made for one server says nothing about the next one.
                authModeTouched: sameAddress ? state.authModeTouched : false,
                ...(sameAddress
                    ? {}
                    : {
                          scopesOffered: [],
                          scopesSelected: [],
                          oauthClientId: "",
                          oauthClientSecretId: null,
                          oauthClientAuthMethod: null,
                      }),
                endpointId: sameAddress ? state.endpointId : null,
                slug: sameAddress ? state.slug : null,
                createdHere: sameAddress ? state.createdHere : false,
            }
        }

        case "url_edited":
            return {...state, url: event.url, error: null}

        case "submit_url":
            if (!state.url.trim()) return state
            return {...state, status: "checking_url", error: null}

        case "url_secret_submitted":
            return {
                ...state,
                status: "naming",
                probe: null,
                name: state.nameTouched ? state.name : event.suggestedName,
                authMode: "api_key",
                authModeTouched: false,
                oauthOffered: false,
                error: null,
            }

        case "probe_succeeded": {
            // The person's choice survives a re-check, except an OAuth choice the server no
            // longer backs with metadata.
            const keepChoice =
                state.authModeTouched &&
                (state.authMode !== "oauth" || event.probe.auth.mode === "oauth")
            return {
                ...state,
                status: "naming",
                probe: event.probe,
                // Discovery improves only a suggestion nobody has edited.
                name: state.nameTouched ? state.name : event.suggestedName,
                authMode: keepChoice ? state.authMode : detectedAuthMode(event.probe),
                authModeTouched: keepChoice,
                oauthOffered: event.probe.auth.mode === "oauth",
                ...withOfferedScopes(state, event.probe.auth.scopes_offered ?? []),
                error: null,
            }
        }

        case "probe_failed":
            // The URL and the name survive, so a retry does not retype them.
            return {
                ...state,
                status: "check_failed",
                probe: event.probe ?? null,
                failureStatus: null,
                error: event.error,
            }

        case "name_changed":
            return {...state, name: event.name, nameTouched: true, error: null}

        case "saved_url_probed":
            return {
                ...state,
                savedUrlProbe: event.probe,
                oauthOffered: state.oauthOffered || event.probe.auth.mode === "oauth",
                ...(event.probe.auth.mode === "oauth"
                    ? withOfferedScopes(state, event.probe.auth.scopes_offered ?? [])
                    : {}),
            }

        case "auth_mode_selected": {
            if (event.mode === state.authMode) return state
            if (event.mode === "oauth" && !state.oauthOffered) return state
            const chosen = {
                ...state,
                authMode: event.mode,
                authModeTouched: true,
                failureStatus: null,
                error: null,
            }
            // A reconnect has no probe and no naming screen. Its row is someone's working
            // connection, so it stays, and the step that writes the credential writes the
            // mode with it.
            if (!state.probe) {
                return {
                    ...chosen,
                    status: event.mode === "oauth" ? "discovering_scopes" : "manual_auth",
                }
            }
            // A first connect goes back to the screen that creates the row, so the row is
            // made in the mode chosen. A pending row made in the old mode is the caller's
            // to delete, as on an address change.
            return {...chosen, status: "naming", endpointId: null, slug: null, createdHere: false}
        }

        case "submit_name":
            if (!state.name.trim()) return state
            return {...state, status: "creating", error: null}

        case "endpoint_created": {
            const next = {
                ...state,
                endpointId: event.endpointId,
                slug: event.slug,
                // Only the first create owns the row; a retry reuses it. An ADOPTED row was
                // found rather than made, and this journey never owns one: cancelling has to
                // leave it exactly as it was found, because the only thing distinguishing it
                // from a row someone else made is that we cannot tell them apart.
                createdHere: state.createdHere || (!state.endpointId && !event.adopted),
                error: null,
            }
            if (state.authMode === "oauth") return {...next, status: "discovering_scopes"}
            if (state.authMode === "none") return {...next, status: "verifying"}
            return {...next, status: "manual_auth"}
        }

        case "create_failed":
            return {...state, status: "create_failed", error: event.error}

        case "name_taken":
            // Back to the field the person can fix, rather than a Try again that would
            // submit the same name and be refused the same way.
            return {...state, status: "naming", error: event.error}

        case "scopes_discovered":
            // Pre-checked: the person is narrowing what was offered, not assembling a
            // request from nothing (D17).
            return {
                ...state,
                status: "choosing_scopes",
                ...withOfferedScopes(state, event.scopes),
                error: null,
            }

        case "scopes_failed":
            return {...state, status: "scopes_failed", error: event.error}

        case "scope_toggled": {
            const selected = state.scopesSelected.includes(event.scope)
                ? state.scopesSelected.filter((scope) => scope !== event.scope)
                : [...state.scopesSelected, event.scope]
            return {...state, scopesSelected: selected}
        }

        case "oauth_client_changed":
            return {
                ...state,
                oauthClientId: event.clientId === undefined ? state.oauthClientId : event.clientId,
                oauthClientSecretId:
                    event.clientSecretId === undefined
                        ? state.oauthClientSecretId
                        : event.clientSecretId,
                oauthClientAuthMethod: event.authMethod ?? state.oauthClientAuthMethod,
            }

        case "oauth_client_loaded": {
            // The client fields and the scope selection come from the row together. The
            // saved scopes win over the all-checked default a check may already have
            // applied, because nothing could be submitted before this.
            const saved = event.config?.scopes ?? null
            return {
                ...state,
                savedOauthConfig: "loaded",
                oauthClientId: event.config?.client_id ?? "",
                oauthClientSecretId: event.config?.client_secret_id ?? null,
                oauthClientAuthMethod: event.config?.token_endpoint_auth_method ?? null,
                scopesSaved: saved,
                scopesSelected: saved
                    ? state.scopesOffered.filter((scope) => saved.includes(scope))
                    : state.scopesSelected,
            }
        }

        case "oauth_client_load_failed":
            return {...state, savedOauthConfig: "failed"}

        case "oauth_client_load_started":
            return {...state, savedOauthConfig: "loading"}

        case "submit_scopes":
            return {...state, status: "awaiting_consent", error: null}

        case "consent_started":
            return {...state, status: "awaiting_consent", error: null}

        case "consent_succeeded":
            return {...state, status: "saving", error: null}

        case "consent_failed":
            return {...state, status: "consent_failed", error: event.error}

        case "consent_cancelled":
            // Not an error state with a success message suppressed: a distinct state, so
            // the caller can offer retry without implying anything was connected.
            return {...state, status: "consent_cancelled", error: event.error}

        case "choose_manual_auth":
            return {...state, status: "manual_auth", error: null}

        case "verify_started":
            return {...state, status: "verifying", error: null}

        case "verify_succeeded":
            return {...state, status: "saving", error: null}

        case "verify_failed":
            return {
                ...state,
                status: "verify_failed",
                failureStatus: event.status ?? null,
                error: event.error,
                endpointId: event.discardedRow ? null : state.endpointId,
                slug: event.discardedRow ? null : state.slug,
                createdHere: event.discardedRow ? false : state.createdHere,
            }

        case "saved":
            // The end of the journey. Nothing is drawn for it: the connection exists, the
            // list has been refreshed, and success is the new row (decision 26). The sheet
            // reads this status as its cue to close.
            return {...state, status: "connected", error: null}

        case "consent_abandoned":
            // Back to the screen that named the connection, with the name kept, rather than
            // out of the dialog altogether: the person abandoned one authorization attempt,
            // not the connection they were making.
            //
            // Only a journey that has a probe has that screen. A reconnect entered at scope
            // discovery and never chose anything, so there is nothing behind it to go back
            // to and its caller closes instead.
            if (!state.probe) return state
            return {...state, status: "naming", error: null}

        case "retry": {
            const target = RETRY_TARGET[state.status]
            if (!target) return state
            return {...state, status: target, error: null}
        }

        default:
            return state
    }
}
