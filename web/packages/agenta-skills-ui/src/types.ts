/** Presentational option types for the skill-registry surfaces. Data arrives as props. */

/** Where a registry skill came from — drives the card avatar tint. */
export type SkillOrigin = "project" | "imported" | "builtin"

/** One registry card / picker row. */
export interface SkillListItem {
    /** Workflow id — the key callers add/remove/open by. */
    id: string
    /** kebab-case registry identity, rendered mono. */
    slug: string
    name: string
    description?: string
    origin: SkillOrigin
    /** Head version tag, e.g. "3" (rendered v3). Builtin entries have none. */
    version?: string
    filesCount?: number
    /** How many agents embed this skill. */
    usedByCount?: number
    /** Humanized age, e.g. "3d ago". Formatting is the host's business. */
    age?: string
    /** Already on the agent being edited (picker context). */
    added?: boolean
    /** The version the agent pins, when added pinned. */
    pinnedVersion?: string
}

/** One revision row in the versions rail. */
export interface SkillVersionRow {
    /** Revision id — the key onSelect answers with. */
    id: string
    /** e.g. "3" (rendered v3). */
    version: string
    message?: string
    age?: string
}

/** One agent chip/row in used-by and save-dialog contexts. */
export interface SkillUsageRef {
    id: string
    name: string
    /** "latest" follows the head; "pinned" fixes pinnedVersion. */
    mode: "latest" | "pinned"
    pinnedVersion?: string
}
