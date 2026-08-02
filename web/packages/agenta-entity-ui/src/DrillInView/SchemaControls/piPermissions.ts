/**
 * Pure read/compose helpers for the Pi harness's `harness.permissions` rule lists.
 *
 * Separated from the control so the persistence contract is unit-testable without a DOM. A rule is
 * either a canonical built-in name (`Bash`) or a prefix pattern (`Bash(npm run:*)`). Apart from
 * surrounding whitespace, a free-typed value is kept verbatim: the runner compares a rule against
 * the gate name and the prefix body character by character.
 */

/** The seven built-in tools, under the canonical names the runner's gates report. */
export const PI_BUILTIN_RULE_NAMES = [
    "Read",
    "Bash",
    "Edit",
    "Write",
    "Grep",
    "Find",
    "Ls",
] as const

export type PiPermissionList = "allow" | "ask" | "deny"

export interface PiPermissionRules {
    allow: string[]
    ask: string[]
    deny: string[]
}

function readList(source: Record<string, unknown>, key: PiPermissionList): string[] {
    const raw = source[key]
    if (!Array.isArray(raw)) return []
    return raw.filter((entry): entry is string => typeof entry === "string")
}

/** The three rule lists, defaulting to empty, from a possibly absent `harness.permissions`. */
export function readPiPermissionRules(value?: Record<string, unknown> | null): PiPermissionRules {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {}
    return {
        allow: readList(source, "allow"),
        ask: readList(source, "ask"),
        deny: readList(source, "deny"),
    }
}

/**
 * The next `harness.permissions` object with one list replaced. Unrelated keys (`default_mode`
 * and anything the schema grows later) are preserved.
 */
export function writePiPermissionRules(
    value: Record<string, unknown> | null | undefined,
    list: PiPermissionList,
    rules: string[],
): Record<string, unknown> {
    const base = value && typeof value === "object" && !Array.isArray(value) ? value : {}
    const current = readPiPermissionRules(base)
    return {
        ...base,
        allow: current.allow,
        ask: current.ask,
        deny: current.deny,
        [list]: rules.map((rule) => rule.trim()).filter(Boolean),
    }
}
