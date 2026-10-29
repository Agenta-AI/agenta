/**
 * Which rows the chat's "Connect your accounts" card lists: only the viewer's own missing items.
 * Pure, so the card and its tests run the same rule.
 */
import {isUserRequirement, type AgentRequirementItem} from "@agenta/entities/workflow"

export interface PersonalSetupItem {
    /** The requirement key, which is the item key of the account choice. */
    key: string
    kind: "app_connection" | "mcp" | "secret"
    /** The Composio integration, the MCP server slug, or the environment variable name. */
    name: string
    /** How many of the viewer's own accounts could fill it. */
    candidates: number
}

const text = (value: unknown): string | null =>
    typeof value === "string" && value ? value : null

/**
 * The "user" requirements a person can set up here, in the server's order. A "user" model login
 * is left out: it blocks the run, and the model setup strip already asks for it.
 */
export const personalSetupItems = (
    requirements: readonly AgentRequirementItem[] | null | undefined,
): PersonalSetupItem[] => {
    const items: PersonalSetupItem[] = []
    for (const req of requirements ?? []) {
        if (!isUserRequirement(req) || req.blocks_run) continue
        const ref = req.reference ?? {}
        const candidates = req.fix?.candidates ?? 0
        if (req.kind === "app_connection") {
            const name = text(ref.integration) ?? req.label
            items.push({key: req.key, kind: "app_connection", name, candidates})
        } else if (req.kind === "mcp_server" || req.kind === "mcp_sign_in") {
            const name = text(ref.slug) ?? req.label
            items.push({key: req.key, kind: "mcp", name, candidates})
        } else if (req.kind === "secret") {
            const name = text(ref.name) ?? req.label
            items.push({key: req.key, kind: "secret", name, candidates})
        }
    }
    return items
}
