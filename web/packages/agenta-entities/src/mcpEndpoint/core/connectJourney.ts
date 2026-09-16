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
 * submit, a popup that never returns, credentials saved but tools unreachable.
 *
 * Two invariants the transitions exist to hold:
 *
 * - Cancelling never destroys a working connection. Cancel during a first connect asks the
 *   caller to delete the pending row it just made; cancel during a reconnect asks for
 *   nothing, because the row was already someone's working server.
 * - A failure never reads as success. Every non-success path lands on a state that carries
 *   an explanation, and `isConnected` is true for exactly the states after credentials are
 *   persisted.
 */
import {normalizeConnectionName} from "./connectionName"
import type {MCPServerProbe} from "./types"

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
    | "discovering_tools"
    | "tools_ready"
    | "no_tools"
    | "tools_failed"

export interface McpToolSummary {
    name: string
    description?: string
}

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
    /** Protocol context: the permissions the authorization server offers. */
    scopesOffered: string[]
    /** Which of them this attempt asks for. A reconnect uses it to step up. */
    scopesSelected: string[]
    /** Identity, once the row exists. Null until then, and never regenerated after. */
    endpointId: string | null
    slug: string | null
    /**
     * Whether this journey created the row it is connecting. A reconnect did not, and must
     * not delete one on cancel.
     */
    createdHere: boolean
    tools: McpToolSummary[]
    error: string | null
}

export type McpJourneyEvent =
    | {type: "url_changed"; url: string}
    | {type: "submit_url"}
    | {type: "probe_succeeded"; probe: MCPServerProbe; suggestedName: string}
    | {type: "probe_failed"; error: string}
    | {type: "name_changed"; name: string}
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
    | {type: "submit_scopes"}
    | {type: "consent_started"}
    | {type: "consent_succeeded"}
    | {type: "consent_failed"; error: string}
    | {type: "consent_cancelled"; error: string}
    | {type: "choose_manual_auth"}
    | {type: "verify_started"}
    | {type: "verify_succeeded"}
    | {type: "verify_failed"; error: string}
    | {type: "saved"}
    | {type: "tools_loaded"; tools: McpToolSummary[]}
    | {type: "tools_failed"; error: string}
    | {type: "retry"}
    | {type: "retry_tools"}

/** Start a first connection. */
export function startJourney(): McpJourneyState {
    return {
        status: "url_entry",
        url: "",
        name: "",
        nameTouched: false,
        probe: null,
        scopesOffered: [],
        scopesSelected: [],
        endpointId: null,
        slug: null,
        createdHere: false,
        tools: [],
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
    authMode?: "oauth" | "api_key" | "none"
}): McpJourneyState {
    return {
        ...startJourney(),
        // Only an OAuth connection has scopes to re-read. A key-authenticated one is repaired
        // by supplying the credential again, and sending it to scope discovery instead just
        // earns the route's refusal that it is not an OAuth target.
        status: endpoint.authMode === "oauth" ? "discovering_scopes" : "manual_auth",
        url: endpoint.url,
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
    "discovering_tools",
    "tools_ready",
    "no_tools",
    "tools_failed",
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
    "discovering_tools",
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
        case "url_changed":
            // Editing the address invalidates what the last probe said about it.
            return {
                ...state,
                status: "url_entry",
                url: event.url,
                probe: null,
                error: null,
            }

        case "submit_url":
            if (!state.url.trim()) return state
            return {...state, status: "checking_url", error: null}

        case "probe_succeeded":
            return {
                ...state,
                status: "naming",
                probe: event.probe,
                // Discovery improves only a suggestion nobody has edited.
                name: state.nameTouched ? state.name : event.suggestedName,
                error: null,
            }

        case "probe_failed":
            // The URL and the name survive, so a retry does not retype them.
            return {...state, status: "check_failed", error: event.error}

        case "name_changed":
            return {...state, name: event.name, nameTouched: true, error: null}

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
            if (state.probe?.auth.mode === "oauth") {
                return {...next, status: "discovering_scopes"}
            }
            if (state.probe?.auth.mode === "none") {
                return {...next, status: "verifying"}
            }
            // The probe could not establish how to authorize, so the person is asked
            // rather than guessed at.
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
                scopesOffered: event.scopes,
                scopesSelected: event.scopes,
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
            return {...state, status: "verify_failed", error: event.error}

        case "saved":
            return {...state, status: "discovering_tools", error: null}

        case "tools_loaded":
            return {
                ...state,
                status: event.tools.length ? "tools_ready" : "no_tools",
                tools: event.tools,
                error: null,
            }

        case "tools_failed":
            // Connected, with a tool problem. The credentials are good and consent is not
            // requested again for this.
            return {...state, status: "tools_failed", error: event.error}

        case "retry_tools":
            if (!isConnected(state)) return state
            return {...state, status: "discovering_tools", error: null}

        case "retry": {
            const target = RETRY_TARGET[state.status]
            if (!target) return state
            return {...state, status: target, error: null}
        }

        default:
            return state
    }
}
