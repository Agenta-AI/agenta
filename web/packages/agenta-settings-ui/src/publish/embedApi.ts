import {
    answeringAgentRow,
    clientErrorMessage,
    asArray,
    asRecord,
    asString,
    pointConnectionAt,
    referencedAppId,
    rethrow,
    type ChannelsClientLike,
    type Row,
    type Scope,
} from "../channels/actions"

// The widget's name is the connection's name, so session titles and the widget header agree.

export type EmbedClient = Pick<
    ChannelsClientLike,
    | "queryChannelConnections"
    | "queryChannelAgents"
    | "createChannelAgent"
    | "editChannelAgent"
    | "createChannelConnection"
    | "editChannelConnection"
    | "archiveChannelConnection"
> & {
    fetchChannelConnectionSetup(body: {connection_id: string}, scope?: Scope): Promise<unknown>
}

export type EmbedTheme = "system" | "light" | "dark"

export interface EmbedAppearance {
    avatarUrl: string
    greeting: string
    /** Up to four; empty ones are dropped on save. */
    starters: string[]
    theme: EmbedTheme
    /** A hex color, or empty for the default. */
    accent: string
}

export interface EmbedSettings {
    id: string
    name: string
    /** One origin per line, as the owner typed them. */
    origins: string
    appearance: EmbedAppearance
}

export interface Embed extends EmbedSettings {
    /** The public id in the widget URL. */
    embedId: string
}

export const MAX_STARTERS = 4

const asText = (value: unknown): string => asString(value) ?? ""

// The same check the API runs on create (an edit skips it, so it is repeated here).
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/
const ACCENT = /^#[0-9a-fA-F]{3,8}$/

/** The typed origins as a list, or an error for the first one that is not an origin. */
export const parseOrigins = (text: string): {origins: string[]; error: string | null} => {
    const origins = text.split(/\s+/).filter(Boolean)
    if (!origins.length) return {origins, error: "Add at least one origin."}
    const bad = origins.find((origin) => !ORIGIN.test(origin))
    return bad
        ? {origins, error: `${bad} is not an origin. Use https://tool.example.com, with no path.`}
        : {origins, error: null}
}

/** An error for appearance values the widget would ignore, or null. */
export const appearanceError = (appearance: EmbedAppearance): string | null => {
    if (appearance.accent.trim() && !ACCENT.test(appearance.accent.trim())) {
        return "Use a hex color for the accent, like #2563eb."
    }
    if (appearance.avatarUrl.trim() && !/^https?:\/\//.test(appearance.avatarUrl.trim())) {
        return "Use an http or https URL for the avatar."
    }
    return null
}

export const mapEmbedRow = (row: Row): Embed | null => {
    const id = asText(row.id)
    const data = asRecord(row.data)
    const embedId = asText(asRecord(data.connection_locator).embed)
    if (!id || !embedId || row.deleted_at) return null
    const rawOrigins = data.allowed_origins
    const appearance = asRecord(data.appearance)
    const theme = appearance.theme
    return {
        id,
        embedId,
        name: asText(row.name),
        origins: Array.isArray(rawOrigins)
            ? rawOrigins.map(asText).filter(Boolean).join("\n")
            : asText(rawOrigins),
        appearance: {
            avatarUrl: asText(appearance.avatar_url),
            greeting: asText(appearance.greeting),
            starters: (Array.isArray(appearance.starters) ? appearance.starters : [])
                .map(asText)
                .slice(0, MAX_STARTERS),
            theme: theme === "light" || theme === "dark" ? theme : "system",
            accent: asText(appearance.accent),
        },
    }
}

/** The project's embeds that answer as this agent, oldest first. */
export const listAgentEmbeds = async (
    client: EmbedClient,
    scope: Scope,
    appId: string,
): Promise<Embed[]> => {
    const res = await client
        .queryChannelConnections({connection: {channel: "embed"}}, scope)
        .catch(rethrow("Could not load the embeds."))
    const embeds = asArray(asRecord(res).connections).flatMap((row) => {
        const embed = asText(row.channel) === "embed" ? mapEmbedRow(row) : null
        return embed ? [embed] : []
    })
    const answering = await Promise.all(
        embeds.map(async (embed) => {
            const agents = await client
                .queryChannelAgents({agent: {connection_id: embed.id}}, scope)
                .catch(rethrow("Could not load the embeds."))
            const row = answeringAgentRow(asArray(asRecord(agents).agents))
            return row ? referencedAppId(row) : null
        }),
    )
    return embeds.filter((_, index) => answering[index] === appId)
}

/** Create an embed and point it at the agent. A failed bind archives the new row again. */
export const createEmbed = async (
    client: EmbedClient,
    scope: Scope,
    appId: string,
    {name, origins}: {name: string; origins: string},
): Promise<string> => {
    const res = await client
        .createChannelConnection(
            {
                connection: {
                    channel: "embed",
                    name: name.trim() || null,
                    data: {allowed_origins: origins},
                },
            },
            scope,
        )
        .catch(rethrow("Could not create the embed."))
    const id = asText(asRecord(asRecord(res).connection).id)
    if (!id) throw new Error("The embed was created without an id.")
    try {
        await pointConnectionAt({client, scope, appId, connectionId: id})
    } catch (error) {
        await client.archiveChannelConnection({connection_id: id}, scope).catch(() => null)
        throw new Error(clientErrorMessage(error, "Could not connect the embed to this agent."))
    }
    return id
}

/** Save the name, the origins and the appearance. `data` merges key by key on the API. */
export const saveEmbed = async (
    client: EmbedClient,
    scope: Scope,
    settings: EmbedSettings,
): Promise<void> => {
    const {id, name, origins, appearance} = settings
    await client
        .editChannelConnection(
            {
                connection_id: id,
                connection: {
                    id,
                    name: name.trim() || null,
                    data: {
                        allowed_origins: origins,
                        appearance: {
                            avatar_url: appearance.avatarUrl.trim() || null,
                            greeting: appearance.greeting.trim() || null,
                            starters: appearance.starters
                                .map((starter) => starter.trim())
                                .filter(Boolean)
                                .slice(0, MAX_STARTERS),
                            theme: appearance.theme,
                            accent: appearance.accent.trim() || null,
                        },
                    },
                },
            },
            scope,
        )
        .catch(rethrow("Could not save the embed."))
}

/** The iframe snippet from the connection's setup document. */
export const fetchEmbedSnippet = async (
    client: EmbedClient,
    scope: Scope,
    connectionId: string,
): Promise<string> => {
    const res = await client
        .fetchChannelConnectionSetup({connection_id: connectionId}, scope)
        .catch(rethrow("Could not load the snippet."))
    const content = asText(asRecord(asRecord(asRecord(res).setup).document).content)
    if (!content) throw new Error("Could not load the snippet.")
    return content
}

export const archiveEmbed = async (
    client: EmbedClient,
    scope: Scope,
    connectionId: string,
): Promise<void> => {
    await client
        .archiveChannelConnection({connection_id: connectionId}, scope)
        .catch(rethrow("Could not archive the embed."))
}
