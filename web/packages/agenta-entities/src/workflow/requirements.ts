/**
 * Agent requirements: schema, copy and pure lookups.
 *
 * A requirement is one item the agent names that is not ready where it runs. The server owns the
 * check; these helpers only match its answer to the config rows. Kind and reason stay plain
 * strings on the wire, so a value this client does not know yet never fails the parse.
 */
import {z} from "zod"

export const agentRequirementSchema = z.object({
    key: z.string(),
    kind: z.string(),
    account_source: z.string().nullish(),
    label: z.string(),
    reference: z.record(z.string(), z.unknown()).nullish(),
    paths: z.array(z.string()).nullish(),
    reason: z.string(),
    blocks_run: z.boolean(),
    fix: z
        .object({
            can_edit_agent: z.boolean().nullish(),
            can_connect: z.boolean().nullish(),
            can_sign_in: z.boolean().nullish(),
            candidates: z.number().nullish(),
            ask: z.object({role: z.string()}).passthrough().nullish(),
        })
        .nullish(),
    detail: z.object({code: z.string()}).passthrough().nullish(),
})

export const agentRequirementsSchema = z.object({
    count: z.number().nullish(),
    status: z.string().nullish(),
    requirements: z.array(agentRequirementSchema).nullish(),
})

export type AgentRequirementItem = z.infer<typeof agentRequirementSchema>

/** The reasons a person fixes with their own account: none yet, or a sign-in that lapsed. */
const PERSONAL_REASONS: ReadonlySet<string> = new Set(["needs_personal_account", "needs_sign_in"])

/**
 * An item each person who runs the agent sets up with their own account. A "user" item can also
 * fail for the project's reason (its MCP server is missing or turned off, or no login serves its
 * model); that one is the agent's problem, like any other item.
 */
export const isPersonalRequirement = (req: AgentRequirementItem): boolean =>
    req.account_source === "user" && PERSONAL_REASONS.has(req.reason)
export type AgentRequirementsResult = z.infer<typeof agentRequirementsSchema>

/** The run failure class and the delivery skip reason the server uses for this problem. */
export const AGENT_NEEDS_SETUP_CODE = "agent_needs_setup"

export const NEEDS_SETUP_LABEL = "Needs setup"
export const AGENT_NEEDS_SETUP_TITLE = "This agent needs setup"
export const MODEL_NEEDS_SETUP_MESSAGE = "The model needs setup before this agent can run."
export const MODEL_SETUP_PLACEHOLDER = "Set up the model to send messages"

const REASON_LABELS: Record<string, string> = {
    not_chosen: "No account chosen",
    not_found: "Not found in this project",
    not_shared: "Not shared with this project",
    turned_off: "Turned off",
    needs_sign_in: "Sign-in expired",
    not_available: "No longer available",
}

/** The second line under the tag; null for a reason this client has no words for. */
export const needsSetupReasonLabel = (reason: string | null | undefined): string | null =>
    (reason && REASON_LABELS[reason]) || null

/** A config path relative to the agent template (`agent.tools[2].connection` -> `tools[2].connection`). */
const templatePath = (path: string): string =>
    path.startsWith("agent.") ? path.slice("agent.".length) : path

const pathIsUnder = (path: string, prefix: string): boolean =>
    path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)

/**
 * The requirement whose paths fall under one config location, e.g. `mcps[0]` or `llm`.
 * A personal requirement is never the agent's problem, so the editor rows skip it.
 */
export const requirementAtPath = (
    requirements: readonly AgentRequirementItem[],
    prefix: string,
): AgentRequirementItem | undefined =>
    requirements.find(
        (req) =>
            !isPersonalRequirement(req) &&
            (req.paths ?? []).some((path) => pathIsUnder(templatePath(path), prefix)),
    )

/** The requirement for one item, matched by kind and the slug (and integration) it names. */
export const requirementForItem = (
    requirements: readonly AgentRequirementItem[],
    match: {kinds: readonly string[]; slug?: string | null; integration?: string | null},
): AgentRequirementItem | undefined => {
    if (!match.slug) return undefined
    return requirements.find((req) => {
        if (isPersonalRequirement(req) || !match.kinds.includes(req.kind)) return false
        const ref = req.reference ?? {}
        if (ref.slug !== match.slug) return false
        return !match.integration || !ref.integration || ref.integration === match.integration
    })
}

/** The first requirement that blocks a run (a model item), if any. */
export const modelRequirement = (
    requirements: readonly AgentRequirementItem[],
): AgentRequirementItem | undefined => requirements.find((req) => req.blocks_run)

/** Whether the viewer can act on a requirement: edit the agent, or sign in again. */
export const canFixRequirement = (req: AgentRequirementItem | undefined): boolean =>
    Boolean(req?.fix?.can_edit_agent || req?.fix?.can_sign_in)
