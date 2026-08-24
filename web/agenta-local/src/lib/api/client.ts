import {z, type ZodType} from "zod"

import {
    agentRevisionSchema,
    agentSchema,
    agentsSchema,
    errorSchema,
    healthSchema,
    providerStatesSchema,
    runtimeSchema,
    sessionDetailSchema,
    sessionSchema,
    sessionsSchema,
    shutdownSchema,
    stopSchema,
} from "./schemas"
import type {AgentInput, ProviderInput, RevisionInput, TurnInput} from "./types"

export class LocalApiError extends Error {
    readonly code: string
    readonly retryable: boolean
    readonly status?: number
    readonly nextStep?: string

    constructor(input: {
        code: string
        message: string
        retryable?: boolean
        status?: number
        nextStep?: string
    }) {
        super(input.message)
        this.name = "LocalApiError"
        this.code = input.code
        this.retryable = input.retryable ?? false
        this.status = input.status
        this.nextStep = input.nextStep
    }
}

const JSON_METHODS = new Set(["POST", "PUT", "PATCH"])

async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    if (!path.startsWith("/api/") && path !== "/health") {
        throw new LocalApiError({
            code: "invalid_path",
            message: "Local API paths must be same-origin",
        })
    }
    // The boundary middleware rejects mutations whose Content-Type is not JSON,
    // including bodyless POSTs (/stop, /shutdown).
    const mutating = init?.method ? JSON_METHODS.has(init.method) : false
    let response: Response
    try {
        response = await fetch(path, {
            ...init,
            credentials: "same-origin",
            headers:
                init?.body || mutating
                    ? {"Content-Type": "application/json", ...init?.headers}
                    : init?.headers,
        })
    } catch (error) {
        throw new LocalApiError({
            code: "service_unreachable",
            message: error instanceof Error ? error.message : "Agenta Local is unreachable",
            retryable: true,
        })
    }

    if (!response.ok) throw await parseError(response)
    if (response.status === 204) return schema.parse(undefined)

    try {
        return schema.parse(await response.json())
    } catch {
        throw new LocalApiError({
            code: "invalid_response",
            message: `The local service returned an invalid response for ${path}`,
            status: response.status,
        })
    }
}

async function parseError(response: Response): Promise<LocalApiError> {
    try {
        const parsed = errorSchema.parse(await response.json())
        return new LocalApiError({
            ...parsed,
            status: response.status,
            nextStep: parsed.next_step,
        })
    } catch {
        return new LocalApiError({
            code: "request_failed",
            message: `Local request failed (${response.status})`,
            status: response.status,
        })
    }
}

const emptySchema = z.void()

export const localApi = {
    health: () => request("/health", healthSchema),
    runtime: () => request("/api/runtime", runtimeSchema),
    shutdown: () => request("/api/runtime/shutdown", shutdownSchema, {method: "POST"}),
    listProviders: () => request("/api/providers", providerStatesSchema),
    putProvider: (provider: string, input: ProviderInput) =>
        request(`/api/providers/${encodeURIComponent(provider)}`, emptySchema, {
            method: "PUT",
            body: JSON.stringify(input),
        }),
    deleteProvider: (provider: string) =>
        request(`/api/providers/${encodeURIComponent(provider)}`, emptySchema, {method: "DELETE"}),
    listAgents: () => request("/api/agents", agentsSchema),
    getAgent: (id: string) => request(`/api/agents/${encodeURIComponent(id)}`, agentSchema),
    createAgent: (input: AgentInput) =>
        request("/api/agents", agentSchema, {method: "POST", body: JSON.stringify(input)}),
    deleteAgent: (id: string) =>
        request(`/api/agents/${encodeURIComponent(id)}`, emptySchema, {method: "DELETE"}),
    commitRevision: (id: string, input: RevisionInput) =>
        request(`/api/agents/${encodeURIComponent(id)}/revisions`, agentRevisionSchema, {
            method: "POST",
            body: JSON.stringify(input),
        }),
    listSessions: () => request("/api/sessions", sessionsSchema),
    getSession: (id: string) =>
        request(`/api/sessions/${encodeURIComponent(id)}`, sessionDetailSchema),
    createSession: (agentRevisionId: string, title?: string) =>
        request("/api/sessions", sessionSchema, {
            method: "POST",
            body: JSON.stringify({agent_revision_id: agentRevisionId, title: title || null}),
        }),
    stopSession: (id: string) =>
        request(`/api/sessions/${encodeURIComponent(id)}/stop`, stopSchema, {method: "POST"}),
    turnRequest: (id: string, input: TurnInput, signal: AbortSignal) =>
        fetch(`/api/sessions/${encodeURIComponent(id)}/turns`, {
            method: "POST",
            credentials: "same-origin",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                input: {content: [{type: "text", text: input.text}]},
                context: {client_turn_id: input.clientTurnId},
            }),
            signal,
        }),
}

export {parseError}
