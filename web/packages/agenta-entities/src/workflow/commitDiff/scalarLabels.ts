/**
 * Human names for the scalar config keys a diff reports.
 *
 * The diff used to print the storage path and the stored value verbatim —
 * `runner.permissions.default  allow → allow_reads`. That is the JSON, not the setting: a reader
 * who has not seen the schema cannot tell what changed or whether it matters.
 *
 * Keys are matched by exact path, because the same leaf means different things under different
 * parents (`harness.permissions.default_mode` is not `runner.permissions.default`). Anything
 * unmapped falls back to a humanized path rather than being hidden — a new template key should
 * read imperfectly, never disappear.
 *
 * Wording follows the config panel's own controls wherever it has one, so the same setting is not
 * called two things in two places. The words come from `CommitDiffText` (see `./text`).
 */
import type {CommitDiffText} from "./text"

/** Segments a humanized path should not lowercase. */
const ACRONYMS: Record<string, string> = {llm: "LLM", api: "API", url: "URL", id: "ID"}

const humanizeSegment = (segment: string): string =>
    Object.hasOwn(ACRONYMS, segment.toLowerCase())
        ? ACRONYMS[segment.toLowerCase()]
        : segment.replace(/[_-]+/g, " ").trim().toLowerCase()

/** `{max_attempts: 3, backoff: "exponential"}` reads as prose; its JSON does not. */
const objectLabel = (raw: Record<string, unknown>, text: CommitDiffText): string | undefined => {
    const entries = Object.entries(raw)
    if (!entries.length) return text.word("none")
    return entries
        .map(([key, value]) => {
            const shown =
                value !== null && typeof value === "object" ? JSON.stringify(value) : String(value)
            return `${humanizeSegment(key)}: ${shown}`
        })
        .join(", ")
}

const field = (obj: unknown, key: string): unknown =>
    obj !== null && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined

/** A secret attachment reads as the variable it sets and the secret behind it. */
const credentialLabel = (entry: unknown): string | undefined => {
    const name = field(field(entry, "binding"), "name")
    const slug = field(field(entry, "secret"), "slug")
    if (typeof name === "string" && typeof slug === "string") return `${name} (${slug})`
    if (typeof name === "string") return name
    return typeof slug === "string" ? slug : undefined
}

/** Per-path wording for one entry of a list value. */
const ITEM_LABELS: Record<string, (item: unknown) => string | undefined> = {
    "sandbox.credentials": credentialLabel,
}

/** One list entry: an object never prints as `[object Object]`. */
const itemLabel = (path: string, item: unknown, text: CommitDiffText): string => {
    const named = Object.hasOwn(ITEM_LABELS, path) ? ITEM_LABELS[path](item) : undefined
    if (named) return named
    if (Array.isArray(item)) return JSON.stringify(item)
    if (item !== null && typeof item === "object") {
        return objectLabel(item as Record<string, unknown>, text) ?? ""
    }
    return String(item)
}

/**
 * `sandbox.permissions.network` → "Sandbox › network". Keeps the parent, because a bare leaf
 * ("network", "default") is ambiguous across sections.
 */
const humanizePath = (path: string): string => {
    const segments = path.split(".").filter(Boolean)
    if (segments.length === 0) return path
    const head = humanizeSegment(segments[0])
    const label =
        segments.length === 1
            ? head
            : `${head} › ${segments.slice(1).map(humanizeSegment).join(" › ")}`
    return label.charAt(0).toUpperCase() + label.slice(1)
}

/** What to call this config key in a diff row. */
export const scalarKeyLabel = (path: string, text: CommitDiffText): string =>
    text.pathLabel(path) ?? humanizePath(path)

/**
 * What to call this value. Known enums resolve to the control's own wording; booleans read as
 * On/Off; everything else is shown as stored, since inventing a name for an arbitrary value
 * would be a guess.
 */
export const scalarValueLabel = (
    path: string,
    value: string | undefined,
    raw: unknown,
    text: CommitDiffText,
): string | undefined => {
    if (value === undefined) return undefined
    const mapped = text.valueLabel(path, value)
    if (mapped) return mapped
    // Only a real boolean reads as On/Off; the string "false" is a value, not a flag.
    if (typeof raw === "boolean") return text.word(raw ? "on" : "off")
    // A rule list is prose, not JSON: `["Bash"]` is punctuation a reader has to decode.
    if (Array.isArray(raw)) {
        return raw.length
            ? raw.map((item) => itemLabel(path, item, text)).join(", ")
            : text.word("none")
    }
    if (raw !== null && typeof raw === "object") {
        return objectLabel(raw as Record<string, unknown>, text)
    }
    return value
}
