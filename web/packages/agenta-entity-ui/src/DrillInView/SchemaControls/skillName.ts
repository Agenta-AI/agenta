/**
 * Client-side mirror of the skill rules pydantic enforces in
 * `sdks/python/agenta/sdk/agents/skills/models.py` and the runner re-checks on the untrusted wire
 * in `services/runner/src/engines/skills.ts`. A name that fails them saves fine (the config is
 * plain JSON to the backend) and then fails the whole agent run on first invoke, so the checks
 * have to exist here too. Keep the constants in sync with the pydantic field bounds.
 */

/** Lowercase alphanumerics joined by single hyphens: the harness uses it as a dir name and `/skill:name`. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 1024
export const SKILL_BODY_MAX = 50_000

/** Shown for a non-string value, which pydantic rejects rather than coerces. */
export const NOT_TEXT = "Must be text."

/** Best-effort slug for a human-written name, offered as a one-click fix. */
export function slugifySkillName(name: string): string {
    return name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, SKILL_NAME_MAX)
        .replace(/-+$/g, "")
}

/**
 * Validate a skill `name`, returning a terse message to show under the field or `undefined` when it
 * is valid. `touched=false` (a still-empty field on a fresh draft) suppresses the "required"
 * message so a new skill drawer does not open shouting at the user — Save stays blocked either way.
 */
export function skillNameError(rawName: unknown, {touched = true} = {}): string | undefined {
    if (rawName === undefined || rawName === null) return touched ? "Required." : undefined
    // Rejected, not coerced: `name` is a pydantic `str`, which refuses 123 outright, while
    // String(123) would sail through the slug pattern below.
    if (typeof rawName !== "string") return NOT_TEXT
    // Checked UNTRIMMED: the form stores what was typed, so trimming here would pass a value the
    // SDK's pattern later rejects.
    const name = rawName
    if (!name.trim()) return touched ? "Required." : undefined
    if ([...name].length > SKILL_NAME_MAX) return `Max ${SKILL_NAME_MAX} characters.`
    if (SKILL_NAME_PATTERN.test(name)) return undefined
    // "weather " looks fine, so the generic rule would read like a false positive.
    if (SKILL_NAME_PATTERN.test(name.trim())) return "No leading or trailing spaces."
    return "Lowercase, digits and hyphens only."
}

/** True when `name` is a valid skill slug. */
export function isValidSkillName(name: unknown): boolean {
    return skillNameError(name) === undefined
}

/**
 * Validate the whole inline skill draft the way the SDK will. Returns the first blocking message,
 * or `undefined` when the draft would parse. `description` and `body` are `min_length=1` on the
 * model, so an empty one fails the run exactly like a bad name does.
 */
export function skillDraftError(draft: Record<string, unknown>): string | undefined {
    return (
        skillNameError(draft.name) ??
        textFieldError(draft.description, "Description", SKILL_DESCRIPTION_MAX) ??
        textFieldError(draft.body, "SKILL.md content", SKILL_BODY_MAX)
    )
}

/** Required, string-typed and within `max`, matching the pydantic field it mirrors. */
function textFieldError(value: unknown, label: string, max: number): string | undefined {
    if (value === undefined || value === null || value === "") return `${label} is required.`
    if (typeof value !== "string") return `${label} must be text.`
    if (!value.trim()) return `${label} is required.`
    if ([...value].length > max) return `${label}: max ${max} characters.`
    return undefined
}
