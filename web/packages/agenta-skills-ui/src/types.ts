/** Presentational option types for the skill-registry surfaces. Data arrives as props. */

/** Where a registry skill came from — drives the card avatar tint. */
export type SkillOrigin = "project" | "imported" | "builtin"

/** One registry card / picker row. */
export interface SkillListItem {
    /** Workflow id — the key callers add/remove/open by. */
    id: string
    /** The key a host adds, removes or opens by: the SKILL.md name in the registry, the
     * workflow slug (random suffix included) in the picker. Never shown as a title. */
    slug: string
    /** The SKILL.md name (`skill_name`), else the workflow name. `skillTitle` makes it readable,
     * and an embed stores it as its sibling `name`. */
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
    /** Import provenance, when this skill came from a repo source. */
    source?: SkillSourceInfo
    /** The workflow is archived (visible only with the show-archived toggle). */
    archived?: boolean
}

/** Where an imported skill came from — shown on the detail drawer and picker rows. */
export interface SkillSourceInfo {
    /** e.g. "obra/superpowers". */
    label: string
    repoUrl?: string
    commitSha?: string
    /** A local edit detached it from updates (kept, never overwritten). */
    detached?: boolean
}

/** One agent chip/row in used-by and save-dialog contexts. */
export interface SkillUsageRef {
    id: string
    name: string
    /** "latest" follows the head; "pinned" fixes pinnedVersion. */
    mode: "latest" | "pinned"
    pinnedVersion?: string
}
