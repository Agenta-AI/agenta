/**
 * Build-kit item identity + the user's per-item disable preference.
 *
 * The build-kit overlay is platform-built and playground-only: it is merged into a throwaway copy of
 * the run parameters and never committed. Every entry it carries costs model context on every turn
 * (`commit_revision` / `test_run` alone embed the agent-template schema), so the user can switch
 * individual entries off; a disabled entry is dropped from the overlay before the merge and never
 * reaches the wire.
 *
 * Identity is shared with the overlay merge (`buildKitOverlay.ts` in @agenta/playground) on purpose:
 * the id the switch writes and the id the merge matches on MUST be the same string, or a disabled
 * item would silently keep being sent.
 *
 * The preference is GLOBAL, not per-revision: the overlay is identical for every agent, and revision
 * ids churn on every commit, so a per-revision key would reset the preference constantly.
 */
import {atomWithStorage} from "jotai/utils"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** Slug of the workflow an `@ag.embed` entry references. */
export const buildKitEmbedSlug = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    const embed = entry["@ag.embed"]
    if (!isRecord(embed)) return undefined
    const refs = embed["@ag.references"]
    if (!isRecord(refs)) return undefined
    const workflow = refs.workflow
    if (isRecord(workflow) && typeof workflow.slug === "string") return workflow.slug
    const revision = refs.workflow_revision
    if (isRecord(revision) && typeof revision.slug === "string") return revision.slug
    return undefined
}

export const buildKitToolId = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    if (entry.type === "platform" && typeof entry.op === "string") return `platform:${entry.op}`
    const slug = buildKitEmbedSlug(entry)
    if (slug) return `workflow:${slug}`
    return typeof entry.name === "string" ? `name:${entry.name}` : undefined
}

export const buildKitSkillId = (entry: unknown): string | undefined => {
    const slug = buildKitEmbedSlug(entry)
    return slug ? `workflow:${slug}` : undefined
}

export const buildKitMcpId = (entry: unknown): string | undefined =>
    isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined

/**
 * The `type: "builtin"` grants (`read` / `bash`) are never switchable. Any custom tool on the wire
 * flips the harness's builtin gating from "defaults" to granted-only, so dropping the `read` grant
 * leaves the build-an-agent skill announced but unloadable (live-QA finding 2026-07-05).
 */
const isForcedBuiltin = (entry: unknown): boolean => isRecord(entry) && entry.type === "builtin"

/**
 * Drop the user's disabled entries from the overlay. Returns the overlay untouched when nothing is
 * disabled, so the common path allocates nothing.
 */
export function filterDisabledBuildKitItems<T extends Record<string, unknown>>(
    overlay: T,
    disabledIds: readonly string[],
): T {
    if (disabledIds.length === 0) return overlay
    const disabled = new Set(disabledIds)
    const next: Record<string, unknown> = {...overlay}
    const sections: [string, (entry: unknown) => string | undefined][] = [
        ["tools", buildKitToolId],
        ["skills", buildKitSkillId],
        ["mcps", buildKitMcpId],
    ]
    for (const [key, getId] of sections) {
        const entries = next[key]
        if (!Array.isArray(entries)) continue
        next[key] = entries.filter((entry) => {
            if (isForcedBuiltin(entry)) return true
            const id = getId(entry)
            return !id || !disabled.has(id)
        })
    }
    return next as T
}

/**
 * Ids the user has switched off. Global + persisted (see the module note above); default empty, so
 * an untouched build kit ships every entry exactly as it does today.
 */
export const buildKitDisabledItemsAtom = atomWithStorage<string[]>(
    "agenta:playground:build-kit-disabled-items",
    [],
    undefined,
    {getOnInit: true},
)
