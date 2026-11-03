/**
 * A skill's mark: the agent chip's chrome, tinted by where the skill came from, with the
 * initials of its name inside. One definition, so the registry's avatar and an agent config's
 * skill row draw the same mark.
 */

export type SkillMarkOrigin = "project" | "imported" | "builtin"

/** The origin's colour; the chip derives its tint from it the way it does for an agent. */
export const SKILL_MARK_COLOR: Record<SkillMarkOrigin, string> = {
    project: "#6b7d3f",
    imported: "#475569",
    builtin: "#1c2c3d",
}

/** The initials of the first two words of a kebab name ("shoot-demo-video" → "sd"), or the
 * first two letters of a one-word name — so a column of marks tells names apart. */
export const skillMarkText = (slug: string): string => {
    const parts = slug.split(/[-_ ]+/).filter(Boolean)
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toLowerCase()
    return (parts[0] ?? "sk").slice(0, 2).toLowerCase()
}
