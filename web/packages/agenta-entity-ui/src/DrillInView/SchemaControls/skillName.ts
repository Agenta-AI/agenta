/**
 * skillName
 *
 * Client-side mirror of the skill-package rules the SDK enforces with pydantic
 * (`sdks/python/agenta/sdk/agents/skills/models.py`, `SkillTemplate`) and the runner re-checks on
 * the untrusted wire (`services/runner/src/engines/skills.ts`).
 *
 * Why this exists: a skill whose `name` is not a lowercase-hyphen slug (e.g. `My Skill`,
 * `Weather`) saves fine — the config is just JSON to the backend — and then fails the whole run
 * the first time the agent is invoked, because `AgentTemplate.from_params` parses `skills` through
 * `parse_skill_templates` and raises `SkillValidationError`. Validating here turns that late,
 * opaque run failure into an inline message at authoring time.
 *
 * The slug rule is not ours to relax: the harnesses (Pi / Claude / OpenCode / Antigravity) key a
 * skill by its directory name and invoke it as `/skill:name`, so the name has to be a safe,
 * lowercase path segment.
 *
 * Keep the constants below in sync with the pydantic field bounds.
 */

/** `^[a-z0-9]+(-[a-z0-9]+)*$` — lowercase alphanumerics joined by single hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 1024
export const SKILL_BODY_MAX = 50_000

/** Best-effort slug for a human-written name, used to suggest a fix in the error message. */
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
    const name = String(rawName ?? "").trim()
    if (!name) return touched ? "Required." : undefined
    if ([...name].length > SKILL_NAME_MAX) return `Max ${SKILL_NAME_MAX} characters.`
    if (SKILL_NAME_PATTERN.test(name)) return undefined
    // Keep it to one short line — the full rule is in the field's tooltip, and the form offers the
    // slugified name as a one-click fix beside this message.
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
    const nameError = skillNameError(draft.name)
    if (nameError) return nameError
    const description = String(draft.description ?? "").trim()
    if (!description) return "Description is required."
    if ([...description].length > SKILL_DESCRIPTION_MAX)
        return `Description: max ${SKILL_DESCRIPTION_MAX} characters.`
    const body = String(draft.body ?? "").trim()
    if (!body) return "SKILL.md content is required."
    if ([...body].length > SKILL_BODY_MAX) return `SKILL.md: max ${SKILL_BODY_MAX} characters.`
    return undefined
}
