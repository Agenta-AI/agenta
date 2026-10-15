import {getWorkflowsClient} from "@agenta/sdk/resources"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import type {AgentaApi} from "@agentaai/api-client"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared"

/** A bundled catalog template. */
export interface InternalAgentTemplateSource {
    kind: "internal"
    key: string
}

/** A template zip the user uploaded into a staging session. */
export interface UploadAgentTemplateSource {
    kind: "upload"
    staging_session_id: string
    attachment_id: string
}

/** The exact package bytes a validation accepted; load refuses a file that changed since. */
export interface AgentTemplateSourcePin {
    version: string
    digest: string
}

/** A template zip in a session's files, for example one the create-template skill wrote. */
export interface SessionFileAgentTemplateSource {
    kind: "session_file"
    session_id: string
    path: string
    pin?: AgentTemplateSourcePin
}

/** A package directory in a public GitHub repository, pinned to a full commit SHA. */
export interface GitHubAgentTemplateSource {
    kind: "github"
    repo_url: string
    commit: string
    path: string
}

export type AgentTemplateSource =
    | InternalAgentTemplateSource
    | UploadAgentTemplateSource
    | SessionFileAgentTemplateSource
    | GitHubAgentTemplateSource

// Hand-written until the Fern client is regenerated with the new source union.
export type AgentTemplateLoadRequest = Omit<AgentaApi.TemplateLoadRequest, "source"> & {
    source: AgentTemplateSource
}
export type AgentTemplateLoadResult = AgentaApi.TemplateLoadResult

export async function loadAgentTemplate(
    request: Omit<AgentTemplateLoadRequest, "project_id">,
    idempotencyKey: string,
    projectId: string,
): Promise<AgentTemplateLoadResult> {
    return getWorkflowsClient().loadAgentTemplate(
        // The generated type still declares the internal source only.
        {...request, project_id: projectId} as unknown as AgentaApi.TemplateLoadRequest,
        {
            headers: {"Idempotency-Key": idempotencyKey},
        },
    )
}

export type AgentTemplateEntry = AgentaApi.AgentTemplateEntry
export type AgentTemplatesQuery = AgentaApi.TemplatesQueryRequest

export async function queryAgentTemplates(
    projectId: string,
    query: AgentTemplatesQuery = {},
): Promise<AgentaApi.TemplatesResponse> {
    // maxRetries 0: the catalog query retries; transport retries on top multiplied into a 40s wait.
    return getWorkflowsClient().queryAgentTemplates(query, {
        queryParams: {project_id: projectId},
        maxRetries: 0,
    })
}

export type AgentTemplateRepositoryScan = AgentaApi.TemplateRepositoryScan

/** `POST /agent-templates/sources/scan`: list the template packages in a public GitHub repo. */
export async function scanAgentTemplateSource(
    projectId: string,
    request: AgentaApi.TemplateSourceScanRequest,
): Promise<AgentTemplateRepositoryScan> {
    return getWorkflowsClient().scanAgentTemplateSource(request, {
        queryParams: {project_id: projectId},
        maxRetries: 0,
        // The server allows a scan 120 seconds; the client default of 30 would cut it short.
        timeoutInSeconds: 130,
    })
}

const agentTemplateValidationIssueSchema = z.object({
    code: z.string(),
    path: z.string().nullable(),
    field: z.string().nullable(),
    message: z.string(),
    next_step: z.string().nullable(),
})

const agentTemplateValidationResultSchema = z.object({
    valid: z.boolean(),
    version: z.string().nullable(),
    digest: z.string().nullable(),
    supported_schema_versions: z.array(z.string()),
    issues: z.array(agentTemplateValidationIssueSchema),
})

export type AgentTemplateValidationIssue = z.infer<typeof agentTemplateValidationIssueSchema>
export type AgentTemplateValidationResult = z.infer<typeof agentTemplateValidationResultSchema>

/**
 * `POST /agent-templates/validate`: parse a template source without creating anything.
 * Raw axios only until the Fern client is regenerated with this endpoint.
 */
export async function validateAgentTemplate(
    source: AgentTemplateSource,
    projectId: string,
): Promise<AgentTemplateValidationResult | null> {
    if (!projectId) return null
    const response = await axios.post(
        `${getAgentaApiUrl()}/agent-templates/validate`,
        {source},
        {params: {project_id: projectId}},
    )
    return safeParseWithLogging(
        agentTemplateValidationResultSchema,
        response.data,
        "[validateAgentTemplate]",
    )
}

/** A failed validate or load call, read from the template error envelope or FastAPI's 422. */
export interface AgentTemplateRequestError {
    /** Null when no response arrived, so the outcome is unknown. */
    status: number | null
    code: string
    message: string
    nextStep: string | null
    retryable: boolean
    /** `details.reason`, e.g. `template_source_digest_mismatch`. */
    reason: string | null
    /** The source field a request validation failure names, e.g. `commit`. */
    field: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null

const responseOf = (error: unknown): {status: number | null; body: unknown} => {
    if (!isRecord(error)) return {status: null, body: undefined}
    // Fern errors carry statusCode/body; axios errors carry response.status/data.
    if (typeof error.statusCode === "number") return {status: error.statusCode, body: error.body}
    const response = error.response
    if (isRecord(response) && typeof response.status === "number")
        return {status: response.status, body: response.data}
    return {status: null, body: undefined}
}

export const parseAgentTemplateError = (error: unknown): AgentTemplateRequestError => {
    const {status, body} = responseOf(error)
    if (status === null) {
        return {
            status: null,
            code: "network_error",
            message: "Couldn't reach Agenta. Check your connection, then try again.",
            nextStep: null,
            retryable: true,
            reason: null,
            field: null,
        }
    }
    const envelope = isRecord(body) && isRecord(body.detail) ? body.detail : body
    if (isRecord(envelope) && typeof envelope.code === "string") {
        const details = isRecord(envelope.details) ? envelope.details : {}
        return {
            status,
            code: envelope.code,
            message: text(envelope.message) ?? "The request failed.",
            nextStep: text(envelope.next_step),
            retryable: envelope.retryable === true,
            reason: text(details.reason),
            field: text(details.field),
        }
    }
    const first = isRecord(body) && Array.isArray(body.detail) ? body.detail[0] : undefined
    if (isRecord(first)) {
        const loc = Array.isArray(first.loc) ? first.loc : []
        const last = loc[loc.length - 1]
        return {
            status,
            code: "invalid_request",
            message: (text(first.msg) ?? "The request is invalid.").replace(/^Value error, /, ""),
            nextStep: null,
            retryable: false,
            reason: null,
            field: typeof last === "string" ? last : null,
        }
    }
    return {
        status,
        code: "request_failed",
        message: status >= 500 ? "Agenta couldn't finish the request." : "The request failed.",
        nextStep: null,
        retryable: status >= 500,
        reason: null,
        field: null,
    }
}

/** What a failed load lets the user do next; only `retry` keeps the Idempotency-Key. */
export type AgentTemplateLoadRecovery = "retry" | "start_over" | "check_again" | "edit_source"

export const agentTemplateLoadRecovery = (
    error: AgentTemplateRequestError,
): AgentTemplateLoadRecovery => {
    if (error.reason === "template_source_digest_mismatch") return "check_again"
    if (error.status === 409) return "start_over"
    if (error.retryable || error.status === null || error.status >= 500) return "retry"
    return "edit_source"
}
