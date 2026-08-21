import {atom} from "jotai"

import type {Workflow} from "../core/schema"

/**
 * The agent roster's search term, and what "matches" means for it.
 *
 * Shared because every app has this roster and they must agree on the rule. WHERE the filtering
 * happens still differs, legitimately: the desktop's roster query pushes the term down to the
 * server (`queryWorkflows({name})`) because that list is paged, while mobile filters the
 * already-derived agent list in place. Same term, same definition of a match, one place to change
 * either.
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
