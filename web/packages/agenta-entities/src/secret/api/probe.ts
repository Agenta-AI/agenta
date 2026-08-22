/**
 * Provider credential probe — `POST /providers/probe`.
 *
 * One action, two answers: did the provider accept this credential, and which models did it name.
 * They are separate statuses because a public catalog can answer without proving a key, and an
 * OpenAI-compatible server may implement generation but not `GET /models`.
 *
 * Called through the shared axios instance rather than the Fern client: the endpoint is new and
 * the generated client has not been regenerated for it yet. Move this to
 * `getProvidersClient().probeProvider(...)` when it has.
 *
 * The credential is spent on one outbound read and never stored — this request is the only place
 * the card's typed key leaves the browser before Done.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared"

/** Did the provider accept the credential? `unknown` means Agenta had no free way to find out. */
export const CREDENTIAL_STATUSES = ["valid", "invalid", "unknown"] as const
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]

/** Which model ids came back. `unsupported` means the provider offers no list at all. */
export const DISCOVERY_STATUSES = ["fetched", "unsupported", "failed"] as const
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number]

const probeResponseSchema = z.object({
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

export type ProbeProviderResponse = z.infer<typeof probeResponseSchema>

/** The credential shape the probe adapters read — the same vocabulary the vault stores. */
export interface ProbeProviderCredentials {
    key?: string
    url?: string
    version?: string
    extras?: Record<string, string>
}

/**
 * Test a credential and fetch the provider's model list.
 *
 * Probe outcomes come back as HTTP 200 with a status inside, so a rejected key is a normal
 * answer, not an exception. Returns `null` only when the payload fails the boundary schema; a
 * transport failure still rejects so the card can tell "provider said no" from "we never asked".
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
    const response = await axios.post(
        `${getAgentaApiUrl()}/providers/probe`,
        {
            ...(kind ? {kind} : {}),
            provider,
            ...(secretId ? {secret_id: secretId} : {}),
        },
        {params: {project_id: projectId}},
    )

    return safeParseWithLogging(probeResponseSchema, response.data, "[probeProvider]")
}
