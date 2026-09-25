import {safeParseWithLogging} from "@agenta/entities/shared"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {
    type AgentaConnection,
    type AgentaConversationResponse,
    agentaConnectionSchema,
    agentaConnectionsResponseSchema,
    agentaConversationResponseSchema,
} from "./schemas"

/**
 * The generated Fern client (`@agentaai/api-client`) predates the connections
 * write path, kind-based grants, and the `/channels/agenta/*` routes -- three
 * calls below go straight over the wire until it is regenerated against a
 * live backend (see this package's report). Everything else this surface
 * needs (agents, spaces, threads) already has a correctly-typed accessor in
 * `@/oss/state/channels` and is reused as-is.
 */

const channelsBase = () => `${getAgentaApiUrl()}/channels`

export async function queryAgentaConnections(): Promise<AgentaConnection[]> {
    const {data} = await axios.post(`${channelsBase()}/connections/query`, {
        connection: {channel: "agenta"},
    })
    const parsed = safeParseWithLogging(
        agentaConnectionsResponseSchema,
        data,
        "[agentaChannelSurface.queryAgentaConnections]",
    )
    return parsed?.connections ?? []
}

export async function createAgentaConnection(input: {
    slug: string
    name?: string
    projectId: string
    bot: string
}): Promise<AgentaConnection | null> {
    const {data} = await axios.post(`${channelsBase()}/connections/`, {
        connection: {
            slug: input.slug,
            name: input.name,
            channel: "agenta",
            // Discarded and re-derived server-side (`create_connection`); the
            // model field is required, so a placeholder satisfies the schema.
            external_key: crypto.randomUUID(),
            data: {project: input.projectId, bot: input.bot},
        },
    })
    return safeParseWithLogging(
        agentaConnectionSchema,
        data?.connection,
        "[agentaChannelSurface.createAgentaConnection]",
    )
}

export async function createAgentaGrant(input: {agentId: string; kind?: string}): Promise<void> {
    await axios.post(`${channelsBase()}/grants/`, {
        grant: {
            agent_id: input.agentId,
            kind: input.kind ?? "private",
            effect: "allow",
            data: {},
        },
    })
}

export async function readAgentaConversation(spaceId: string): Promise<AgentaConversationResponse> {
    const {data} = await axios.get(`${channelsBase()}/agenta/conversations/${spaceId}`)
    return (
        safeParseWithLogging(
            agentaConversationResponseSchema,
            data,
            "[agentaChannelSurface.readAgentaConversation]",
        ) ?? {count: 0, items: []}
    )
}

/**
 * The public ingress route (`/channels/agenta/events/`), authenticated by an
 * Agenta API key on the request -- never the browser session. `fetchJson`
 * only fills `Authorization` when the caller hasn't set one, so the shared
 * axios instance (which always overwrites it with the session bearer) is the
 * wrong tool here.
 */
export async function postAgentaEvent(input: {
    apiKey: string
    projectId: string
    bot: string
    userId: string
    text: string
}): Promise<void> {
    const url = new URL(`${channelsBase()}/agenta/events/`)
    await fetchJson(url, {
        method: "POST",
        headers: {Authorization: `ApiKey ${input.apiKey}`},
        body: JSON.stringify({
            project: input.projectId,
            bot: input.bot,
            user: input.userId,
            text: input.text,
        }),
    })
}
