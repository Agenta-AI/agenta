/**
 * Provider credential probe — `POST /providers/probe`.
 *
 * One action, two answers: did the provider accept this credential, and which models did it name.
 * They are separate statuses because a public catalog can answer without proving a key, and an
 * OpenAI-compatible server may implement generation but not `GET /models`.
 *
 * Called through the Fern-generated secrets client, so the request and response stay aligned with
 * the backend OpenAPI contract.
 *
 * The credential is spent on one outbound read and never stored — this request is the only place
 * the card's typed key leaves the browser before Done.
 */

import {AgentaApi} from "@agentaai/api-client"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared"

import {getSecretsClient, projectScopedRequest} from "./client"

/** Did the provider accept the credential? `unknown` means Agenta had no free way to find out. */
export const CREDENTIAL_STATUSES = [
    AgentaApi.CredentialStatus.Valid,
    AgentaApi.CredentialStatus.Invalid,
    AgentaApi.CredentialStatus.Unknown,
] as const
export type CredentialStatus = AgentaApi.CredentialStatus

/** Which model ids came back. `unsupported` means the provider offers no list at all. */
export const DISCOVERY_STATUSES = [
    AgentaApi.DiscoveryStatus.Fetched,
    AgentaApi.DiscoveryStatus.Unsupported,
    AgentaApi.DiscoveryStatus.Failed,
] as const
export type DiscoveryStatus = AgentaApi.DiscoveryStatus

const probeResponseSchema: z.ZodType<AgentaApi.ProbeProviderResponse> = z.object({
    credential: z.object({
        status: z.enum(CREDENTIAL_STATUSES),
        message: z.string(),
    }),
    discovery: z.object({
        status: z.enum(DISCOVERY_STATUSES),
        models: z.array(z.string()).default([]),
    }),
    fetched_at: z.string(),
})

export type ProbeProviderResponse = AgentaApi.ProbeProviderResponse

/** The credential shape the probe adapters read — the same vocabulary the vault stores. */
export type ProbeProviderCredentials = AgentaApi.ProviderCredentials

/**
 * Test a credential and fetch the provider's model list.
 *
 * Probe outcomes come back as HTTP 200 with a status inside, so a rejected key is a normal
 * answer, not an exception. Returns `null` only when the independent boundary schema detects a
 * drifted payload; a transport failure still rejects.
 *
 * `secretId` names a stored vault row for the server to resolve credentials from, which is how a
 * write-only connection is testable at all — see `probeRequestFor`, which decides when to send it.
 * Anything the caller also puts in `provider` overrides what the server resolved.
 */
export const probeProvider = async ({
    projectId,
    kind,
    provider,
    secretId,
}: {
    projectId: string
    /** Omitted when `secretId` is given: the stored row names its own kind. */
    kind?: string
    provider: ProbeProviderCredentials
    secretId?: string
}): Promise<ProbeProviderResponse | null> => {
    const response = await getSecretsClient().probeProvider(
        {
            ...(kind ? {kind} : {}),
            provider,
            ...(secretId ? {secret_id: secretId} : {}),
        },
        projectScopedRequest(projectId),
    )

    return safeParseWithLogging(probeResponseSchema, response, "[probeProvider]")
}
