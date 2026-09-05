/**
 * Skill embed writer — builds the `@ag.embed` entries an agent config's `skills` list
 * stores, and reads them back.
 *
 * Contract (verified against the resolver and `describeSkill`):
 * - Reference LEVEL encodes pin/follow: an ARTIFACT ref (`workflow: {slug, id}`) follows
 *   the head ("latest"); a REVISION ref (`workflow_revision: {slug, version}`) pins.
 * - A SIBLING `name` (and `description`) must ride next to `@ag.embed`: `staticEmbedName`
 *   reads `skill.name` first, and without it every row renders the raw slug.
 * - List mutations are INDEX-BASED via entity-ui's `itemListOps` (append / replace-at-index
 *   / remove-at-index), driven by the host — this module only produces/reads entries and
 *   never touches the list, preserving the carry-by-reference guarantee.
 */

export type SkillEmbedMode = "latest" | "pinned"

export interface SkillEmbedTarget {
    /** The skill workflow's slug (registry identity). */
    slug: string
    /** The skill workflow's id — belt-and-braces on a "latest" ref. */
    workflowId?: string
    /** Display name for the config row (sibling key, required for rendering). */
    name: string
    description?: string
    /** "latest" follows the head; "pinned" fixes `version`. */
    mode: SkillEmbedMode
    /** Required when mode is "pinned". */
    version?: string
}

export interface SkillEmbedEntry {
    "@ag.embed": {
        "@ag.references": Record<string, Record<string, unknown>>
    }
    name: string
    description?: string
}

/** Build the stored entry for one skill reference. */
export function buildSkillEmbedEntry(target: SkillEmbedTarget): SkillEmbedEntry {
    const references: Record<string, Record<string, unknown>> = target.mode === "pinned"
        ? {
              workflow_revision: {
                  slug: target.slug,
                  ...(target.version ? {version: target.version} : {}),
              },
          }
        : {
              workflow: {
                  slug: target.slug,
                  ...(target.workflowId ? {id: target.workflowId} : {}),
              },
          }

    return {
        "@ag.embed": {"@ag.references": references},
        name: target.name,
        ...(target.description ? {description: target.description} : {}),
    }
}

const asObj = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined

/** Whether a skills-list entry is an `@ag.embed` reference (vs an inline package). */
export function isSkillEmbedEntry(entry: unknown): boolean {
    const obj = asObj(entry)
    return Boolean(obj && "@ag.embed" in obj)
}

export interface ParsedSkillEmbed {
    slug?: string
    workflowId?: string
    mode: SkillEmbedMode
    version?: string
    name?: string
    description?: string
}

/** Read an embed entry back into its target fields; undefined for non-embed entries. */
export function parseSkillEmbedEntry(entry: unknown): ParsedSkillEmbed | undefined {
    const obj = asObj(entry)
    if (!obj) return undefined
    const refs = asObj(asObj(obj["@ag.embed"])?.["@ag.references"])
    if (!refs) return undefined

    const revisionRef = asObj(refs.workflow_revision)
    const workflowRef = asObj(refs.workflow)
    const pinned = Boolean(revisionRef)
    const ref = revisionRef ?? workflowRef

    return {
        slug: typeof ref?.slug === "string" ? ref.slug : undefined,
        workflowId: typeof workflowRef?.id === "string" ? workflowRef.id : undefined,
        mode: pinned ? "pinned" : "latest",
        version: typeof revisionRef?.version === "string" ? revisionRef.version : undefined,
        name: typeof obj.name === "string" ? obj.name : undefined,
        description: typeof obj.description === "string" ? obj.description : undefined,
    }
}
