import {platformLabel} from "./helpers"
import type {
    ChannelAudiencePerson,
    ChannelBehaviorState,
    ChannelChatType,
    ChannelConnection,
    ChannelConnections,
    ChannelPeopleDirectory,
    ChannelPerson,
    ChannelPlatform,
    ChannelReadableChannel,
    ChannelSetupIdentity,
    ChannelSetupInfo,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
    ChannelSpaceMembership,
    ChannelsActions,
    ChannelToolSettings,
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

export type Scope = {queryParams: {project_id: string}} | undefined

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
    editChannelConnection(body: object, scope?: Scope): Promise<unknown>
    fetchChannelSetup(body: object, scope?: Scope): Promise<unknown>
    createTelegramHostedBindLink(body: object, scope?: Scope): Promise<unknown>
    listTelegramHostedBindings(body: object, scope?: Scope): Promise<unknown>
    queryChannelSpaces(body: object, scope?: Scope): Promise<unknown>
    discoverChannelSpaces(body: object, scope?: Scope): Promise<unknown>
    createChannelSpace(body: object, scope?: Scope): Promise<unknown>
    queryChannelGrants(body: object, scope?: Scope): Promise<unknown>
    createChannelGrant(body: object, scope?: Scope): Promise<unknown>
    deleteChannelGrant(body: object, scope?: Scope): Promise<unknown>
    queryChannelPeople(body: object, scope?: Scope): Promise<unknown>
    refreshChannelPeople(body: object, scope?: Scope): Promise<unknown>
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

export type Row = Record<string, unknown>

export const asRecord = (value: unknown): Row =>
    value && typeof value === "object" ? (value as Row) : {}

export const asArray = (value: unknown): Row[] => (Array.isArray(value) ? value.map(asRecord) : [])

export const asString = (value: unknown): string | null =>
    typeof value === "string" && value ? value : null

/** The backend channel key for a platform and install mode. */
export const channelKey = (platform: ChannelPlatform, hosted: boolean): string =>
    platform === "telegram" ? (hosted ? "telegram_hosted" : "telegram") : platform

const platformOf = (channel: string): ChannelPlatform | null =>
    (["telegram", "slack", "whatsapp"] as const).find((platform) => channel.startsWith(platform)) ??
    null

/** The first reference id in a channel agent's `data.references` (the app it answers as). */
export const referencedAppId = (agent: Row): string | null => {
    const references = asRecord(asRecord(agent.data).references)
    for (const value of Object.values(references)) {
        const id = asString(asRecord(value).id)
        if (id) return id
    }
    return null
}

const asSpaceKind = (value: unknown): ChannelSpaceKind =>
    value === "private" || value === "topic" ? value : "group"

const asSpaceMembership = (value: unknown): ChannelSpaceMembership | null =>
    value === "member" || value === "joinable" || value === "invite_required" ? value : null

/**
 * A v4 uuid, without `crypto.randomUUID`.
 *
 * `randomUUID` exists only in a secure context, and /m is served over plain HTTP on a dev
 * box, where calling it throws and blanks the page. The service derives the real external
 * key from the locator and discards this value, but the wire schema still demands a uuid.
 */
const randomUuid = (): string => {
    const bytes = new Uint8Array(16)
    const source = typeof crypto !== "undefined" ? crypto : undefined
    if (source?.getRandomValues) source.getRandomValues(bytes)
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A bot's channel tool settings from its `data.tools`. A bot stored before the block existed
 * has none, and each missing field reads as its default.
 */
export const toolSettingsOf = (agent: Row): ChannelToolSettings => {
    const tools = asRecord(asRecord(agent.data).tools)
    const keys = tools.readable_space_keys
    return {
        canPostOutsideConversation: tools.can_post_outside_conversation !== false,
        readableSpaceKeys: Array.isArray(keys)
            ? keys.map((key) => asString(key)).filter((key): key is string => key !== null)
            : null,
    }
}

/** The platform id in a space locator: a Slack `channel`, a Telegram `chat_id`. */
export const locatorId = (locator: Row): string | null => {
    const value = locator.channel ?? locator.chat_id
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return asString(value)
}

/** What a place with no stored name is called: its platform id, else a plain noun. */
export const unnamedSpaceLabel = (kind: ChannelSpaceKind, externalId: string | null): string => {
    if (!externalId) return kind === "topic" ? "Unnamed channel" : "Unnamed group"
    // Slack channel ids start with C (public), G (private) or D (a DM); Telegram's are numbers.
    return /^\d|^-\d/.test(externalId) ? `Group ${externalId}` : `#${externalId}`
}

/** Map a backend space row to the design's shape. A private space is always "Direct messages". */
export const mapSpaceRow = (row: Row): ChannelSpace | null => {
    const id = asString(row.id)
    if (!id || row.deleted_at) return null
    const kind = asSpaceKind(row.kind)
    const name = asString(row.name) ?? asString(row.description)
    const externalId = locatorId(asRecord(asRecord(row.data).external_locator))
    const externalKey = asString(row.external_key)
    const keyed = externalKey ? {externalKey} : {}
    if (kind === "private") return {id, kind, name: "Direct messages", externalId, ...keyed}
    // A place first seen through a message is stored without a name; the panel swaps in the
    // name discovery reports, and until then the platform id tells two such places apart.
    return name
        ? {id, kind, name, externalId, ...keyed}
        : {id, kind, name: unnamedSpaceLabel(kind, externalId), externalId, unnamed: true, ...keyed}
}

/** Fill the unnamed places with the names discovery reports for the same platform id. */
export const nameSpacesFrom = (
    spaces: ChannelSpace[],
    candidates: ChannelSpaceCandidate[],
): ChannelSpace[] => {
    const names = new Map<string, string>()
    for (const candidate of candidates) {
        const id = locatorId(candidate.externalLocator)
        if (id && candidate.displayName) names.set(id, candidate.displayName)
    }
    return spaces.map((space) => {
        const discovered = space.unnamed && space.externalId ? names.get(space.externalId) : null
        return discovered ? {...space, name: discovered, unnamed: false} : space
    })
}

/** The card's chat type for a space kind: only "is it a DM" changes the row's copy. */
export const chatTypeOf = (kind: ChannelSpaceKind, platform: ChannelPlatform): ChannelChatType => {
    if (kind === "private") return "dm"
    return platform === "slack" ? "channel" : "group"
}

/** The space kinds the "group" switch covers. A Slack channel is a topic-bearing space. */
export const groupKindsOf = (platform: ChannelPlatform): ChannelSpaceKind[] =>
    platform === "slack" ? ["group", "topic"] : ["group"]

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
    const data = asRecord(row.data)
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
            // A WhatsApp connection is known by its business phone number.
            if (platform === "whatsapp") return asString(data.display_phone_number)
            const name = asString(data.bot_username)
            return name ? `@${name.replace(/^@/, "")}` : null
        })(),
        workspaceName: asString(data.team_name),
        // New installs keep it flat on `data`; every install has it in the routing locator.
        appId: asString(data.api_app_id) ?? asString(asRecord(data.connection_locator).api_app_id),
        webhookUrl: asString(data.webhook_url),
        webhookVerifyToken: asString(data.webhook_verify_token),
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

/** The project's connections as one agent sees them: its summary row per platform and its own list. */
export const connectionsForAgent = (
    rows: ChannelConnection[],
    appId: string,
): ChannelConnections => {
    // One row per platform in the design, but a platform may now hold both a hosted and a
    // custom connection. The one that answers as this agent wins whatever its status —
    // a revoked bot of this agent is the row the user came to fix. Among the rest, a live
    // connection beats a pending one, and a pending one beats a revoked one.
    const rank = (c: ChannelConnection) => {
        const here = c.agent === undefined || c.agent?.id === appId ? 4 : 0
        return here + (c.status === "connected" ? 2 : c.status === "pending" ? 1 : 0)
    }
    const out: ChannelConnections = {slack: null, telegram: null, whatsapp: null}
    const mine: Record<ChannelPlatform, ChannelConnection[]> = {
        slack: [],
        telegram: [],
        whatsapp: [],
    }
    for (const connection of rows) {
        const current = out[connection.platform]
        if (!current || rank(connection) > rank(current)) out[connection.platform] = connection
        if (connection.agent?.id === appId) mine[connection.platform].push(connection)
    }
    // The summarized connection leads its platform's list; the rest keep the backend order.
    const lead = (platform: ChannelPlatform) => {
        const primary = out[platform]
        const list = mine[platform]
        return primary && list.includes(primary)
            ? [primary, ...list.filter((c) => c !== primary)]
            : list
    }
    out.agentConnections = {
        slack: lead("slack"),
        telegram: lead("telegram"),
        whatsapp: lead("whatsapp"),
    }
    out.allConnections = rows
    return out
}

/**
 * Make a connection answer as an app: create the default channel agent when the connection has
 * none, retarget the answering one and turn it on otherwise, no-op when it already answers there.
 */
export const pointConnectionAt = async ({
    client,
    scope,
    appId,
    connectionId,
}: {
    client: Pick<
        ChannelsClientLike,
        "queryChannelAgents" | "createChannelAgent" | "editChannelAgent"
    >
    scope: Scope
    appId: string
    connectionId: string
}): Promise<void> => {
    const res = await client.queryChannelAgents({agent: {connection_id: connectionId}}, scope)
    const answering = answeringAgentRow(asArray(asRecord(res).agents))
    const references = {application: {id: appId}}
    if (!answering) {
        await client.createChannelAgent(
            {
                agent: {
                    connection_id: connectionId,
                    slug: "default",
                    name: "Default agent",
                    data: {references},
                    flags: {is_default: true},
                },
            },
            scope,
        )
        return
    }
    const flags = asRecord(answering.flags)
    if (referencedAppId(answering) === appId && flags.is_active !== false) return
    const agentId = asString(answering.id)
    if (!agentId) throw new Error("The connection's agent has no id.")
    // A restore can bring the binding back off (someone else's private agent): connecting
    // turns it on. The edit writes the whole flags, so `is_default` stays as stored.
    await client.editChannelAgent(
        {
            agent_id: agentId,
            agent: {id: agentId, data: {references}, flags: {...flags, is_active: true}},
        },
        scope,
    )
}

/** One rule of where an agent answers: by kind of place, or for one place. */
export type BehaviorRule =
    | {effect: "allow" | "deny"; kind: ChannelSpaceKind}
    | {effect: "allow"; spaceId: string}

/**
 * Where the agent answers, read from its grants. With no grant it answers everywhere. Once a
 * grant exists, a place no rule names is refused and any deny wins. "Only these channels" is
 * allow rules for single places with no rule for the channel kinds, so it reads back as chosen.
 * A space's default-agent rule is an allow rule for that place like any other: the backend
 * counts it, so it reads as a chosen channel.
 */
export const behaviorFromGrants = (
    platform: ChannelPlatform,
    grants: Row[],
): ChannelBehaviorState => {
    if (grants.length === 0) return {dm: true, group: true, spaceIds: null}
    const kindRule = (kind: ChannelSpaceKind, effect: "allow" | "deny") =>
        grants.some(
            (grant) =>
                !grant.space_id &&
                asString(grant.kind) === kind &&
                (grant.effect === "deny" ? "deny" : "allow") === effect,
        )
    const chosen = grants
        .filter((grant) => grant.effect !== "deny" && asString(grant.space_id))
        .map((grant) => asString(grant.space_id) as string)
    const groupKinds = groupKindsOf(platform)
    const dm = !kindRule("private", "deny") && kindRule("private", "allow")
    if (groupKinds.some((kind) => kindRule(kind, "deny")))
        return {dm, group: false, spaceIds: chosen.length ? chosen : null}
    if (groupKinds.some((kind) => kindRule(kind, "allow"))) return {dm, group: true, spaceIds: null}
    return {dm, group: true, spaceIds: chosen}
}

/**
 * The rules for a behavior state, written by the switches and the Advanced row together.
 * "Only these channels" never writes a deny for channels, because any deny wins; channels
 * nobody checked match no rule and are refused. With channels switched off, the chosen places
 * stay stored (the kind deny wins over them), so switching channels back on restores them.
 */
export const rulesForBehavior = (
    platform: ChannelPlatform,
    next: ChannelBehaviorState,
): BehaviorRule[] => {
    const chosen: BehaviorRule[] = (next.spaceIds ?? []).map((spaceId) => ({
        effect: "allow",
        spaceId,
    }))
    if (next.group && next.spaceIds !== null) {
        // Always one rule for DMs here: with DMs off and nothing checked, no rule at all
        // would read as "answers everywhere".
        return [
            {effect: next.dm ? ("allow" as const) : ("deny" as const), kind: "private" as const},
            ...chosen,
        ]
    }
    // Both on, every channel: the unrestricted state is "no grant at all".
    if (next.dm && next.group) return []
    const groupKinds = groupKindsOf(platform)
    const kinds: ChannelSpaceKind[] = ["private", ...groupKinds]
    return [
        ...kinds.map((kind) => ({
            effect: (kind === "private" ? next.dm : next.group)
                ? ("allow" as const)
                : ("deny" as const),
            kind,
        })),
        ...chosen,
    ]
}

/** The people list on a channel agent row (`data.audience`). */
export const audienceOf = (agent: Row): ChannelAudiencePerson[] => {
    const audience = asRecord(asRecord(agent.data).audience)
    const labels = asRecord(audience.labels)
    const senders = Array.isArray(audience.senders) ? audience.senders : []
    return senders
        .map((value) => String(value).trim())
        .filter(Boolean)
        .map((id) => {
            const label = asRecord(labels[id])
            return {id, name: asString(label.name), email: asString(label.email)}
        })
}

/** The audience block an agent edit sends: the ids, and their labels for display. */
export const audienceBody = (people: ChannelAudiencePerson[]) => ({
    senders: people.map((person) => person.id),
    labels: Object.fromEntries(
        people
            .filter((person) => person.name || person.email)
            .map((person) => [person.id, {name: person.name, email: person.email}]),
    ),
})

export const mapPersonRow = (row: Row): ChannelPerson => {
    const source = row.source
    return {
        id: String(row.id ?? ""),
        name: asString(row.name),
        email: asString(row.email),
        username: asString(row.username),
        isGuest: row.is_guest === true,
        isBot: row.is_bot === true,
        isDeleted: row.is_deleted === true,
        source:
            source === "recent_senders" || source === "directory" || source === "email_lookup"
                ? source
                : null,
    }
}

export const mapDirectory = (value: unknown): ChannelPeopleDirectory => {
    const row = asRecord(value)
    const state = row.state
    return {
        state:
            state === "ready" || state === "loading" || state === "failed" ? state : "unavailable",
        updatedAt: asString(row.updated_at),
    }
}

export const rethrow = (fallback: string) => (error: unknown) => {
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

    const pointHere = (connectionId: string) =>
        pointConnectionAt({client, scope: scope(), appId, connectionId})

    /** The channel agent row that answers on this connection — the subject of every grant. */
    const channelAgentId = async (connectionId: string): Promise<string> => {
        const answering = answeringAgentRow(await agentsOf(connectionId))
        const id = answering ? asString(answering.id) : null
        if (!id) throw new Error("This connection answers as no agent yet.")
        return id
    }

    const listSpaces = async (connectionId: string): Promise<ChannelSpace[]> => {
        const res = await client
            .queryChannelSpaces({space: {connection_id: connectionId}}, scope())
            .catch(rethrow("Could not load where this connection answers."))
        return asArray(asRecord(res).spaces)
            .map(mapSpaceRow)
            .filter((space): space is ChannelSpace => space !== null)
    }

    const discoverSpaces = async (connectionId: string): Promise<ChannelSpaceCandidate[]> => {
        const res = await client
            .discoverChannelSpaces({connection_id: connectionId}, scope())
            .catch(rethrow("Could not list the channels this app can see."))
        return asArray(asRecord(res).candidates).map((row) => ({
            kind: asSpaceKind(row.kind),
            externalLocator: asRecord(row.external_locator),
            displayName:
                asString(row.display_name) ??
                unnamedSpaceLabel(asSpaceKind(row.kind), locatorId(asRecord(row.external_locator))),
            isConfigured: row.is_configured === true,
            membership: asSpaceMembership(row.membership),
            externalKey: asString(row.external_key),
        }))
    }

    const addSpace = async (
        connectionId: string,
        candidate: ChannelSpaceCandidate,
    ): Promise<void> => {
        await client
            .createChannelSpace(
                {
                    space: {
                        connection_id: connectionId,
                        kind: candidate.kind,
                        // The service derives the real key from the locator and discards this.
                        external_key: randomUuid(),
                        name: candidate.displayName,
                        data: {external_locator: candidate.externalLocator},
                    },
                },
                scope(),
            )
            .catch(rethrow("Could not add this channel."))
    }

    /** This agent's grants: the rules that say where it answers. */
    const agentGrants = async (agentId: string): Promise<Row[]> => {
        const res = await client
            .queryChannelGrants({grant: {agent_id: agentId}}, scope())
            .catch(rethrow("Could not read where this agent may answer."))
        return asArray(asRecord(res).grants).filter((grant) => !grant.deleted_at)
    }

    const readBehavior = async (
        platform: ChannelPlatform,
        connectionId: string,
    ): Promise<ChannelBehaviorState> =>
        behaviorFromGrants(platform, await agentGrants(await channelAgentId(connectionId)))

    const writeBehavior = async (
        platform: ChannelPlatform,
        connectionId: string,
        next: ChannelBehaviorState,
    ): Promise<void> => {
        const agentId = await channelAgentId(connectionId)
        const grants = await agentGrants(agentId)
        const wanted = rulesForBehavior(platform, next)
        const keyOf = (rule: BehaviorRule) =>
            `${rule.effect}:${"spaceId" in rule ? `space:${rule.spaceId}` : `kind:${rule.kind}`}`
        // A stored row's key, in the same form. A deny for one place (only the API writes
        // one) never matches a wanted rule, so the save removes it.
        const grantKey = (grant: Row): string | null => {
            const effect = grant.effect === "deny" ? "deny" : "allow"
            const spaceId = asString(grant.space_id)
            if (spaceId) return `${effect}:space:${spaceId}`
            const kind = asString(grant.kind)
            return kind ? `${effect}:kind:${asSpaceKind(kind)}` : null
        }
        const wantedKeys = new Set(wanted.map(keyOf))
        const kept = new Set<string>()

        // Which stored rows stay, and which go: a space's default-agent rule included, since
        // the backend counts it as an allow rule for that place.
        const obsolete: string[] = []
        for (const grant of grants) {
            const key = grantKey(grant)
            if (!key) continue
            if (wantedKeys.has(key) && !kept.has(key)) {
                kept.add(key)
                continue
            }
            const grantId = asString(grant.id)
            if (grantId) obsolete.push(grantId)
        }
        // New rules first, then the old ones go. In between, the stored rules are the old and
        // the new together, which never admits a place that neither admits; removing first
        // could pass through "no rule at all", which answers everywhere.
        for (const rule of wanted) {
            if (kept.has(keyOf(rule))) continue
            await client
                .createChannelGrant(
                    {
                        grant: {
                            agent_id: agentId,
                            effect: rule.effect,
                            ...("spaceId" in rule ? {space_id: rule.spaceId} : {kind: rule.kind}),
                            data: {},
                        },
                    },
                    scope(),
                )
                .catch(rethrow("Could not save this setting."))
        }
        for (const grantId of obsolete) {
            await client
                .deleteChannelGrant({grant_id: grantId}, scope())
                .catch(rethrow("Could not save this setting."))
        }
    }

    const readAudience = async (connectionId: string): Promise<ChannelAudiencePerson[]> =>
        audienceOf(await answeringAgent(connectionId))

    const writeAudience = async (
        connectionId: string,
        people: ChannelAudiencePerson[],
    ): Promise<void> => {
        const agentId = asString((await answeringAgent(connectionId)).id)
        // The edit replaces the whole audience block and leaves the rest of `data` as stored.
        await client
            .editChannelAgent(
                {
                    agent_id: agentId,
                    agent: {id: agentId, data: {audience: audienceBody(people)}},
                },
                scope(),
            )
            .catch(rethrow("Could not save who can message it."))
    }

    const queryPeople = async (connectionId: string, text: string, ids?: string[]) => {
        const res = await client
            .queryChannelPeople(
                {connection_id: connectionId, people: {text, ...(ids?.length ? {ids} : {})}},
                scope(),
            )
            .catch(rethrow("Could not search people."))
        return {
            people: asArray(asRecord(res).people).map(mapPersonRow),
            directory: mapDirectory(asRecord(res).directory),
        }
    }

    const refreshPeople = async (connectionId: string) => {
        const res = await client
            .refreshChannelPeople({connection_id: connectionId}, scope())
            .catch(rethrow("Could not refresh the people list."))
        return mapDirectory(asRecord(res).directory)
    }

    const updateCredentials = async (
        connectionId: string,
        credentials: Record<string, string>,
    ): Promise<void> => {
        await client
            .editChannelConnection(
                {connection_id: connectionId, connection: {id: connectionId, credentials}},
                scope(),
            )
            .catch(rethrow("The platform rejected the new credentials."))
    }

    const answeringAgent = async (connectionId: string): Promise<Row> => {
        const answering = answeringAgentRow(
            await agentsOf(connectionId).catch(rethrow("Could not read this bot's settings.")),
        )
        if (!answering) throw new Error("This connection answers as no agent yet.")
        return answering
    }

    const readToolSettings = async (connectionId: string): Promise<ChannelToolSettings> =>
        toolSettingsOf(await answeringAgent(connectionId))

    const writeToolSettings = async (
        connectionId: string,
        next: ChannelToolSettings,
    ): Promise<void> => {
        const agentId = asString((await answeringAgent(connectionId)).id)
        // The edit layers `data` over the stored row, so sending only `tools` leaves the
        // references and the policy as they are.
        await client
            .editChannelAgent(
                {
                    agent_id: agentId,
                    agent: {
                        id: agentId,
                        data: {
                            tools: {
                                can_post_outside_conversation: next.canPostOutsideConversation,
                                readable_space_keys: next.readableSpaceKeys,
                            },
                        },
                    },
                },
                scope(),
            )
            .catch(rethrow("Could not save this setting."))
    }

    /** Slack lists the channels the app can see and says which ones the bot is in. A Telegram
     * bot cannot list its chats, so its stored groups stand in. */
    const listReadableChannels = async (
        platform: ChannelPlatform,
        connectionId: string,
    ): Promise<ChannelReadableChannel[]> => {
        if (platform === "slack") {
            return (await discoverSpaces(connectionId)).flatMap((candidate) =>
                candidate.membership === "member" && candidate.externalKey
                    ? [
                          {
                              key: candidate.externalKey,
                              name: candidate.displayName,
                              kind: candidate.kind,
                          },
                      ]
                    : [],
            )
        }
        return (await listSpaces(connectionId)).flatMap((space) =>
            space.kind !== "private" && space.externalKey
                ? [{key: space.externalKey, name: space.name, kind: space.kind}]
                : [],
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
        const rows = asArray(asRecord(res).connections)
            .map(mapConnectionRow)
            .filter((row): row is ChannelConnection => row !== null)
        await Promise.all(
            rows.map(async (connection) => {
                if (!connection.connectionId) return
                const answering = answeringAgentRow(
                    await agentsOf(connection.connectionId).catch(
                        rethrow("Could not determine which agent answers on this connection."),
                    ),
                )
                const id = answering ? referencedAppId(answering) : null
                connection.agent = id ? {id, name: resolveAgentName(id)} : null
                // A binding can be off while its connection stays connected.
                connection.agentOff = answering
                    ? asRecord(answering.flags).is_active === false
                    : false
                connection.audienceCount = answering ? audienceOf(answering).length : 0
                // The row's copy counts the places it answers in ("1 group + DMs") and says
                // when the agent's rules limit them. One call each per connection, side by
                // side, and a failure only costs the count, not the row.
                const answeringId = answering ? asString(answering.id) : null
                const [listed, grants] = await Promise.all([
                    listSpaces(connection.connectionId).catch(() => null),
                    answeringId ? agentGrants(answeringId).catch(() => null) : null,
                ])
                if (listed) {
                    connection.chats = listed.map((space) => ({
                        name: space.name,
                        type: chatTypeOf(space.kind, connection.platform),
                    }))
                }
                if (grants) connection.behavior = behaviorFromGrants(connection.platform, grants)
                // A hosted Telegram connection is created when the link is minted, before
                // any chat tapped Start. Until a chat is bound it is pending, not connected.
                if (
                    connection.platform === "telegram" &&
                    connection.kind === "hosted" &&
                    connection.status === "connected"
                ) {
                    const bound = await countHostedTelegramBindings(connection.connectionId).catch(
                        rethrow("Could not check whether Telegram is linked. Try again."),
                    )
                    if (bound === 0) connection.status = "pending"
                }
            }),
        )
        return connectionsForAgent(rows, appId)
    }

    const loadSetup = async (
        platform: ChannelPlatform,
        identity?: ChannelSetupIdentity,
    ): Promise<ChannelSetupInfo> => {
        const res = await client
            .fetchChannelSetup({channel: channelKey(platform, false), ...identity}, scope())
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
                pattern: asString(field.pattern),
                patternError: asString(field.pattern_error),
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
    ): Promise<ChannelConnection | null> => {
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
            .catch(rethrow(`${platformLabel(platform)} rejected the credentials.`))
        const row = asRecord(asRecord(res).connection)
        const connectionId = asString(row.id)
        if (!connectionId) throw new Error("The connection was created without an id.")
        await pointHere(connectionId).catch(
            rethrow("The connection was created, but could not be pointed at this agent."),
        )
        return mapConnectionRow(row)
    }

    const connectHere = async (platform: ChannelPlatform, connectionId: string) =>
        pointHere(connectionId).catch(rethrow("Could not connect this agent."))

    /** Turn the answering binding back on. The edit carries its references, so the server
     *  checks the agent under a lock and refuses a private agent of someone else. */
    const turnOn = async (platform: ChannelPlatform, connectionId: string) => {
        const answering = await answeringAgent(connectionId)
        const agentId = asString(answering.id)
        if (!agentId) throw new Error("This connection answers as no agent yet.")
        await client
            .editChannelAgent(
                {
                    agent_id: agentId,
                    agent: {
                        id: agentId,
                        data: {references: asRecord(answering.data).references},
                        // The edit writes the whole flags: keep `is_default` as stored.
                        flags: {...asRecord(answering.flags), is_active: true},
                    },
                },
                scope(),
            )
            .catch(rethrow(`Could not turn ${platformLabel(platform)} on.`))
    }

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
        turnOn,
        listSpaces,
        discoverSpaces,
        addSpace,
        readBehavior,
        writeBehavior,
        readAudience,
        writeAudience,
        queryPeople,
        refreshPeople,
        updateCredentials,
        readToolSettings,
        writeToolSettings,
        listReadableChannels,
    }
}
