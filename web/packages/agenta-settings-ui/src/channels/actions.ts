import type {
    ChannelConnection,
    ChannelConnections,
    ChannelPlatform,
    ChannelSetupInfo,
    ChannelsActions,
    HostedTelegramLink,
} from "./types"

/**
 * Builds the real `ChannelsActions` for one agent page on top of the generated channels
 * client. Both hosts (desktop `web/oss` and `/m`) hand in their client and project id and get
 * the same behavior: the mapping from backend rows to the design's shapes, the answering-agent
 * resolution, the retarget ("connect here"), and the custom-app create.
 *
 * The client is typed structurally with only the calls used here, so this package does not
 * depend on `@agentaai/api-client` directly; hosts pass `getChannelsClient()` from
 * `@agenta/sdk/resources`.
 */

type Scope = {queryParams: {project_id: string}} | undefined

/**
 * The subset of the generated `ChannelsClient` this module calls.
 *
 * The members are METHOD signatures, not properties holding a function type. Under
 * `strictFunctionTypes` a property's parameters are checked contravariantly, so a generated
 * method that takes a request with a REQUIRED field (`createChannelAgent`) does not satisfy a
 * property typed `(body: object) => …`, and neither host could pass its real client. Method
 * signatures are checked bivariantly, which is how the generated client declares them.
 */
export interface ChannelsClientLike {
    queryChannelConnections(body: object, scope?: Scope): Promise<unknown>
    queryChannelAgents(body: object, scope?: Scope): Promise<unknown>
    createChannelAgent(body: object, scope?: Scope): Promise<unknown>
    editChannelAgent(body: object, scope?: Scope): Promise<unknown>
    createChannelConnection(body: object, scope?: Scope): Promise<unknown>
    archiveChannelConnection(body: object, scope?: Scope): Promise<unknown>
    fetchChannelSetup(body: object, scope?: Scope): Promise<unknown>
    createTelegramHostedBindLink(body: object, scope?: Scope): Promise<unknown>
    listTelegramHostedBindings(body: object, scope?: Scope): Promise<unknown>
}

export interface AgentChannelsActionsOptions {
    client: ChannelsClientLike
    /** The project in scope; every call is scoped to it. */
    projectId: () => string | null
    /** The agent (application) whose page is open. */
    appId: string
    /** Resolve an application id to its display name; null when unknown. */
    resolveAgentName: (appId: string) => string | null
    /** The hosted Slack install URL for this deployment, or null when not offered. */
    hostedSlackInstallUrl: (projectId: string) => string | null
}

type Row = Record<string, unknown>

const asRecord = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {})

const asArray = (value: unknown): Row[] => (Array.isArray(value) ? value.map(asRecord) : [])

const asString = (value: unknown): string | null =>
    typeof value === "string" && value ? value : null

/** The backend channel key for a platform and install mode. */
export const channelKey = (platform: ChannelPlatform, hosted: boolean): string =>
    platform === "telegram" ? (hosted ? "telegram_hosted" : "telegram") : "slack"

const platformOf = (channel: string): ChannelPlatform | null =>
    channel.startsWith("telegram") ? "telegram" : channel.startsWith("slack") ? "slack" : null

/** The first reference id in a channel agent's `data.references` (the app it answers as). */
export const referencedAppId = (agent: Row): string | null => {
    const references = asRecord(asRecord(agent.data).references)
    for (const value of Object.values(references)) {
        const id = asString(asRecord(value).id)
        if (id) return id
    }
    return null
}

/** The active default channel agent of a connection, or its first active agent. */
export const answeringAgentRow = (agents: Row[]): Row | null => {
    const active = agents.filter((agent) => !agent.deleted_at)
    if (active.length === 0) return null
    return active.find((agent) => asRecord(agent.flags).is_default === true) ?? active[0]
}

/** Map a backend connection row to the design's shape (without the answering agent). */
export const mapConnectionRow = (row: Row): ChannelConnection | null => {
    if (row.deleted_at) return null
    const channel = asString(row.channel) ?? ""
    const platform = platformOf(channel)
    if (!platform) return null
    const flags = asRecord(row.flags)
    return {
        connectionId: asString(row.id) ?? undefined,
        platform,
        kind: flags.is_hosted === true ? "hosted" : "custom",
        status: flags.is_active === false ? "revoked" : "connected",
        dm: "allow",
        group: "allow",
        chats: [],
        connectedAt: asString(row.created_at),
        handle: (() => {
            const name = asString(asRecord(row.data).bot_username)
            return name ? `@${name.replace(/^@/, "")}` : null
        })(),
    }
}

/** A readable message from a rejected client call. */
export const clientErrorMessage = (error: unknown, fallback: string): string => {
    const record = asRecord(error)
    // Fern's ApiError carries the parsed body; a plain fetch error may carry `response`.
    const body = asRecord(record.body)
    const detail = body.detail ?? asRecord(record.response).detail
    if (typeof detail === "string" && detail.trim()) return detail
    // The API's unexpected-error shape: {detail: {message, operation_id}}.
    const detailMessage = asRecord(detail).message
    if (typeof detailMessage === "string" && detailMessage.trim()) return detailMessage
    const status = Number(record.statusCode)
    if (Number.isFinite(status) && status >= 500) return fallback
    if (typeof record.message === "string" && record.message.trim()) {
        // A bare message, minus Fern's "Status code: …\nBody: …" wrapper when present.
        const line = record.message.split("\n")[0]
        return /^Status code:/i.test(line) ? fallback : record.message
    }
    return fallback
}

const rethrow = (fallback: string) => (error: unknown) => {
    throw new Error(clientErrorMessage(error, fallback))
}

export const buildAgentChannelsActions = ({
    client,
    projectId,
    appId,
    resolveAgentName,
    hostedSlackInstallUrl,
}: AgentChannelsActionsOptions): ChannelsActions => {
    const scope = (): Scope => {
        const id = projectId()
        return id ? {queryParams: {project_id: id}} : undefined
    }

    const references = () => ({application: {id: appId}})

    const agentsOf = async (connectionId: string): Promise<Row[]> => {
        const res = await client.queryChannelAgents({agent: {connection_id: connectionId}}, scope())
        return asArray(asRecord(res).agents)
    }

    /** Make the connection answer as this page's agent: create the default agent when the
     * connection has none, retarget the answering one otherwise, no-op when it already
     * points here. */
    const pointHere = async (connectionId: string): Promise<void> => {
        const answering = answeringAgentRow(await agentsOf(connectionId))
        if (!answering) {
            await client.createChannelAgent(
                {
                    agent: {
                        connection_id: connectionId,
                        slug: "default",
                        name: "Default agent",
                        data: {references: references()},
                        flags: {is_default: true},
                    },
                },
                scope(),
            )
            return
        }
        if (referencedAppId(answering) === appId) return
        const agentId = asString(answering.id)
        if (!agentId) throw new Error("The connection's agent has no id.")
        await client.editChannelAgent(
            {agent_id: agentId, agent: {id: agentId, data: {references: references()}}},
            scope(),
        )
    }

    const countHostedTelegramBindings = async (connectionId: string): Promise<number> => {
        const res = await client.listTelegramHostedBindings({connection_id: connectionId}, scope())
        const count = Number(asRecord(res).count)
        return Number.isFinite(count) ? count : 0
    }

    const reload = async (): Promise<ChannelConnections> => {
        const res = await client
            .queryChannelConnections({}, scope())
            .catch(rethrow("Could not load the channel connections."))
        const out: ChannelConnections = {slack: null, telegram: null}
        for (const row of asArray(asRecord(res).connections)) {
            const mapped = mapConnectionRow(row)
            if (!mapped) continue
            // one connection per platform in the design; the first active one wins
            if (out[mapped.platform]?.status === "connected") continue
            out[mapped.platform] = mapped
        }
        await Promise.all(
            (["slack", "telegram"] as const).map(async (platform) => {
                const connection = out[platform]
                if (!connection?.connectionId) return
                try {
                    const answering = answeringAgentRow(await agentsOf(connection.connectionId))
                    const id = answering ? referencedAppId(answering) : null
                    connection.agent = id ? {id, name: resolveAgentName(id)} : null
                } catch {
                    connection.agent = undefined // unresolved: treated as "here"
                }
                // A hosted Telegram connection is created when the link is minted, before
                // any chat tapped Start. Until a chat is bound it is pending, not connected.
                if (
                    platform === "telegram" &&
                    connection.kind === "hosted" &&
                    connection.status === "connected"
                ) {
                    try {
                        const bound = await countHostedTelegramBindings(connection.connectionId)
                        if (bound === 0) connection.status = "pending"
                    } catch {
                        /* unknown: keep "connected" rather than hide a live connection */
                    }
                }
            }),
        )
        return out
    }

    const loadSetup = async (platform: ChannelPlatform): Promise<ChannelSetupInfo> => {
        const res = await client
            .fetchChannelSetup({channel: channelKey(platform, false)}, scope())
            .catch(rethrow(`Could not load the ${platform} setup.`))
        const setup = asRecord(asRecord(res).setup)
        return {
            manifest: asString(asRecord(setup.document).content),
            fields: asArray(setup.fields).map((field) => ({
                name: asString(field.name) ?? "",
                label: asString(field.label) ?? asString(field.name) ?? "",
                secret: field.secret === true,
                required: field.required !== false,
                help: asString(field.help),
            })),
            hostedAvailable: setup.hosted_available === true,
        }
    }

    const connectHostedTelegram = async (): Promise<HostedTelegramLink> => {
        const res = await client
            .createTelegramHostedBindLink({references: references()}, scope())
            .catch(rethrow("The hosted Telegram bot is not available on this deployment."))
        const body = asRecord(res)
        const url = asString(body.url)
        const connectionId = asString(body.connection_id)
        if (!url || !connectionId) throw new Error("The bind link response is incomplete.")
        const expires = Number(body.expires_in_seconds)
        return {url, connectionId, expiresInSeconds: Number.isFinite(expires) ? expires : 1800}
    }

    const connectCustom = async (
        platform: ChannelPlatform,
        values: Record<string, string>,
    ): Promise<void> => {
        const setup = await loadSetup(platform)
        const data: Record<string, string> = {}
        const credentials: Record<string, string> = {}
        for (const field of setup.fields) {
            const value = values[field.name]
            if (value === undefined || value === "") continue
            if (field.secret) credentials[field.name] = value
            else data[field.name] = value
        }
        const res = await client
            .createChannelConnection(
                {connection: {channel: channelKey(platform, false), data, credentials}},
                scope(),
            )
            .catch(
                rethrow(`${platform === "slack" ? "Slack" : "Telegram"} rejected the credentials.`),
            )
        const connectionId = asString(asRecord(asRecord(res).connection).id)
        if (!connectionId) throw new Error("The connection was created without an id.")
        await pointHere(connectionId).catch(
            rethrow("The connection was created, but could not be pointed at this agent."),
        )
    }

    const connectHere = async (_platform: ChannelPlatform, connectionId: string) =>
        pointHere(connectionId).catch(rethrow("Could not connect this agent."))

    const disconnect = async (_platform: ChannelPlatform, connectionId: string) => {
        await client
            .archiveChannelConnection({connection_id: connectionId}, scope())
            .catch(rethrow("Could not disconnect."))
    }

    return {
        reload,
        loadSetup,
        connectHostedTelegram,
        countHostedTelegramBindings,
        hostedSlackInstallUrl: async () => {
            const id = projectId()
            if (!id) return null
            const setup = await loadSetup("slack").catch(() => null)
            if (setup && !setup.hostedAvailable) return null
            return hostedSlackInstallUrl(id)
        },
        connectCustom,
        connectHere,
        disconnect,
    }
}
