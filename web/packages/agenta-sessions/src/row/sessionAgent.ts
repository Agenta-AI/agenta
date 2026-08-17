import type {SessionStream} from "@agenta/entities/session"
import {isValidUUID} from "@agenta/shared/utils"

/**
 * The agent a session row opens on — its workflow ARTIFACT id — or null when the row names none.
 *
 * References arrive as a flat list, one element per member of the workflow family, each naming
 * which member it is in `key`. Only the `workflow` element is an app id; a variant or revision id
 * sends the playground to a route that does not exist, which is why a keyed row without a
 * `workflow` element resolves to null rather than to whatever id happens to come first.
 *
 * ANY non-empty key counts as keyed, not just the ones we act on. The backend stores keys
 * permissively, so a key this code does not recognise still proves the writer labelled the family
 * — treating it as unkeyed would fall through to the heuristic below and open the wrong id.
 *
 * Rows written before the family carried keys have none at all. For those the first UUID is the
 * only thing on offer, so the original heuristic stands — narrowing it would hide history that
 * opens correctly today.
 */
export const sessionAgentId = (row: SessionStream): string | null => {
    const usable = (row.references ?? []).filter((ref) => ref.id && isValidUUID(ref.id))
    const workflow = usable.find((ref) => ref.key === "workflow")
    if (workflow?.id) return workflow.id
    if (usable.some((ref) => Boolean(ref.key))) return null
    return usable[0]?.id ?? null
}
