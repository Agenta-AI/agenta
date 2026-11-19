import {createT, type CatalogKey} from "@agenta/i18n"
import agentConfigCatalog from "@agenta/i18n/catalogs/entityUi.agentConfig"
import {skillDisplayName, stripStaticSkillPrefix} from "@agenta/shared/utils"

// Every helper here translates when called, so a re-rendering card reads the current language.
const tNow = createT(agentConfigCatalog)

/**
 * Reduce an agent revision's `parameters` to the handful of facts an overview row can state.
 *
 * Shape (verified against stored revisions): `parameters.agent` carries `llm{model,provider}`,
 * `harness{kind}`, `sandbox{kind}`, `runner{kind,permissions{default}}`,
 * `instructions{agents_md}` and the flat `tools` / `mcps` / `skills` arrays.
 *
 * Everything is optional on purpose: a revision written before a field existed, or an agent that
 * never set one, yields `null` and the row says so rather than the card failing to render.
 */
export interface AgentConfigSummary {
    model: string | null
    harness: string | null
    /** Word count of AGENTS.md, so the row can say how much instruction there is. */
    instructionWords: number | null
    /** The brief itself, raw — `InstructionsFileRow` derives its own preview from the markdown. */
    instructions: string | null
    tools: number
    /** The integration behind each gateway-connection tool (`linear`, `github`), in tool order,
     * deduplicated — so an overview can show the marks rather than only the count. */
    integrationKeys: string[]
    mcps: number
    skills: number
    /** Display names of the agent's skills (embed refs by their sibling name/slug, inline
     * packages by their own name), so the overview row can list them. */
    skillNames: string[]
    sandbox: string | null
    /** Default tool permission, e.g. "allow_reads". */
    permissions: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

/** A skill entry's readable title: the sibling `name` (embed refs carry it too), else the
 * referenced workflow slug, else null (an unparseable entry stays counted but unnamed). */
const skillName = (entry: unknown): string | null => {
    if (!isRecord(entry)) return null
    const name = str(entry.name)
    if (name) return skillDisplayName(stripStaticSkillPrefix(name))
    const refs = nested(nested(entry, "@ag.embed"), "@ag.references")
    const slug = str(nested(refs, "workflow")?.slug) ?? str(nested(refs, "workflow_revision")?.slug)
    return slug ? skillDisplayName(stripStaticSkillPrefix(slug)) : null
}

/** A gateway-connection tool's integration key; null for a custom or builtin tool. */
const integrationKey = (entry: unknown): string | null =>
    isRecord(entry) && entry.type === "gateway_connection"
        ? str(nested(entry, "connection")?.integration)
        : null

const nested = (parent: unknown, key: string): Record<string, unknown> | null => {
    if (!isRecord(parent)) return null
    const child = parent[key]
    return isRecord(child) ? child : null
}

/** `pi_core` → `Pi core`. No lookup table: a wrong friendly name is worse than a plain one. */
export function prettifyKind(kind: string | null): string | null {
    if (!kind) return null
    const spaced = kind.replace(/[_-]+/g, " ").trim()
    return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : null
}

export function agentConfigSummary(parameters: unknown): AgentConfigSummary {
    const agent = nested(parameters, "agent") ?? (isRecord(parameters) ? parameters : {})

    const instructions = str(nested(agent, "instructions")?.agents_md)

    return {
        model: str(nested(agent, "llm")?.model),
        harness: prettifyKind(str(nested(agent, "harness")?.kind)),
        // Whitespace-split rather than a token count: this is "how long is the brief", not billing.
        instructionWords: instructions ? instructions.split(/\s+/).filter(Boolean).length : null,
        instructions,
        // The `agenta_tools` entry is a setting, not a tool the author added.
        tools: Array.isArray(agent.tools)
            ? agent.tools.filter((entry) => !isRecord(entry) || entry.type !== "agenta_tools")
                  .length
            : 0,
        integrationKeys: Array.isArray(agent.tools)
            ? [
                  ...new Set(
                      agent.tools.map(integrationKey).filter((key): key is string => Boolean(key)),
                  ),
              ]
            : [],
        mcps: count(agent.mcps),
        skills: count(agent.skills),
        skillNames: Array.isArray(agent.skills)
            ? agent.skills.map(skillName).filter((name): name is string => Boolean(name))
            : [],
        sandbox: prettifyKind(str(nested(agent, "sandbox")?.kind)),
        permissions: str(nested(nested(agent, "runner"), "permissions")?.default),
    }
}

/**
 * What the MCP servers row says, on every summary card.
 *
 * "configured", not "connected": this counts the servers on the agent, and whether each one
 * is authorized is a live fact no summary card holds. Saying "connected" claimed the
 * authorized state for a disconnected server, in the one word the rest of the product now
 * reserves for it (round 4, D5). The rule lives here so no card can drift back to the wrong
 * word.
 */
export const mcpSummaryDetail = (mcps: number, {canEdit = false} = {}): string =>
    mcps
        ? tNow("entityUi.agentConfig.mcpsConfigured", {count: mcps})
        : canEdit
          ? tNow("entityUi.agentConfig.connectAServer")
          : tNow("entityUi.agentConfig.noneConfigured")

/**
 * What the skills row says. Same shape as the MCP row's, and here for the same reason: an empty
 * row on a card whose rows open the editor has to offer the action, not report the absence. The
 * mobile card said "No skills" beside its own "Add instructions", which is the drift this stops.
 */
export const skillsSummaryDetail = (skills: number, {canEdit = false} = {}): string =>
    skills
        ? tNow("entityUi.agentConfig.skillsCount", {count: skills})
        : canEdit
          ? tNow("entityUi.agentConfig.addSkills")
          : tNow("entityUi.agentConfig.noneAvailable")

/**
 * What the instructions row says. `AGENTS.md · 28 words`, or the action when there is no brief.
 * The mobile card abbreviated the count to `28w` for a narrow row, which is a different string
 * for the same fact and the kind of difference nothing was watching.
 */
export const instructionsSummaryDetail = (words: number | null, {canEdit = false} = {}): string =>
    words
        ? tNow("entityUi.agentConfig.instructionsWords", {count: words})
        : canEdit
          ? tNow("entityUi.agentConfig.addInstructions")
          : tNow("entityUi.agentConfig.noInstructions")

/**
 * The tools row's wording. Its noun is the one thing each host names for itself: the playground
 * calls them tools and the mobile overview calls them integrations. Everything else about the row
 * comes from here, so an empty row cannot offer an action on one app and report a fact on the
 * other.
 */
export interface AgentConfigToolsCopy {
    toolsTitle: string
    toolsCount: (count: number) => string
    toolsAdd: string
    toolsNone: string
}

const toolsCount = (count: number) => tNow("entityUi.agentConfig.enabledCount", {count})

/**
 * The two nouns the hosts use ("tools", "integrations") have their own translated sentences; the
 * getters read the language when the row renders. Any other noun stays in English.
 */
export const toolsCopyFor = (noun: string, plural: string): AgentConfigToolsCopy => {
    if (noun === "tools") {
        return {
            get toolsTitle() {
                return tNow("entityUi.agentConfig.tools")
            },
            toolsCount,
            get toolsAdd() {
                return tNow("entityUi.agentConfig.addTools")
            },
            get toolsNone() {
                return tNow("entityUi.agentConfig.noTools")
            },
        }
    }
    if (noun === "integrations") {
        return {
            get toolsTitle() {
                return tNow("entityUi.agentConfig.integrations")
            },
            toolsCount,
            get toolsAdd() {
                return tNow("entityUi.agentConfig.addIntegrations")
            },
            get toolsNone() {
                return tNow("entityUi.agentConfig.noIntegrations")
            },
        }
    }
    return {toolsTitle: plural, toolsCount, toolsAdd: `Add ${noun}`, toolsNone: `No ${noun}`}
}

/** The playground's own nouns, and the default every host gets. */
export const DEFAULT_TOOLS_COPY: AgentConfigToolsCopy = {
    get toolsTitle() {
        return tNow("entityUi.agentConfig.tools")
    },
    toolsCount,
    get toolsAdd() {
        return tNow("entityUi.agentConfig.addTools")
    },
    get toolsNone() {
        return tNow("entityUi.agentConfig.noneEnabled")
    },
}

/**
 * The rows every agent summary card shows, in order, with the title each one carries.
 *
 * What must not differ between cards is WHICH rows there are and what they are called, so the
 * vocabulary lives here and every card reads it.
 *
 * The tools row's noun is the one variable: the mobile card calls it Integrations.
 */
export const AGENT_CONFIG_ROW_KEYS = [
    "model",
    "instructions",
    "tools",
    "mcps",
    "skills",
    "permissions",
] as const

export type AgentConfigRowKey = (typeof AGENT_CONFIG_ROW_KEYS)[number]

export const AGENT_CONFIG_ROW_TITLES: Record<AgentConfigRowKey, string> = {
    get model() {
        return tNow("entityUi.agentConfig.model")
    },
    get instructions() {
        return tNow("entityUi.agentConfig.instructions")
    },
    get tools() {
        return tNow("entityUi.agentConfig.tools")
    },
    get mcps() {
        return tNow("entityUi.agentConfig.mcpServers")
    },
    get skills() {
        return tNow("entityUi.agentConfig.skills")
    },
    get permissions() {
        return tNow("entityUi.agentConfig.permissions")
    },
}

/**
 * What the permissions row says. "Not set" rather than a blank: a revision written before the
 * field existed has no default, and an empty right-hand side reads as a value that failed to
 * load.
 */
export const permissionsSummaryDetail = (permissions: string | null): string => {
    const pretty = prettifyKind(permissions)
    if (!permissions || !pretty) return tNow("entityUi.agentConfig.notSet")
    // A known stored value reads translated; an unknown one shows prettified.
    return Object.hasOwn(PERMISSION_DETAIL_KEYS, permissions)
        ? tNow(PERMISSION_DETAIL_KEYS[permissions])
        : pretty
}

/** Keyed by the stored `runner.permissions.default` value. */
const PERMISSION_DETAIL_KEYS: Record<string, CatalogKey<typeof agentConfigCatalog>> = {
    allow: "entityUi.agentConfig.permissionAllow",
    allow_reads: "entityUi.agentConfig.permissionAllowReads",
    ask: "entityUi.agentConfig.permissionAsk",
    deny: "entityUi.agentConfig.permissionDeny",
}
