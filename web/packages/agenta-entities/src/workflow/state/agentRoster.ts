import {atom} from "jotai"

import type {Workflow} from "../core/schema"

/**
 * The agent roster's search term, and what "matches" means for it.
 *
 * Shared so every roster surface agrees on the rule: one definition of a match, one place to
 * change it.
 */
export const agentRosterSearchAtom = atom("")

/** Name, slug and description — the fields a roster row actually shows. */
export const matchesAgentQuery = (
    workflow: Pick<Workflow, "name" | "slug" | "description">,
    query: string,
): boolean => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    const haystack = `${workflow.name ?? ""} ${workflow.slug ?? ""} ${workflow.description ?? ""}`
    return haystack.toLowerCase().includes(needle)
}
