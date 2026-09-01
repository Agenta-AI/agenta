/**
 * Text helpers shared by the approval describers and the generic preview. A leaf module so the
 * describers and `approvalPreview` can both use it without importing each other.
 */
import {drivePathFromToolPath, PATH_KEYS} from "@agenta/entities/session"

// Collapsed rows truncate to one line with CSS; expanded rows show the full string. This cap is
// only a safety net so a pathological pasted file cannot bloat the DOM — it sits well past a normal
// instruction or skill body, which must survive intact for the expand affordance to be useful.
const DETAIL_CHARS = 4000

/** Collapse whitespace and clamp — a value pasted from a file must not become a paragraph. */
export const oneLine = (text: string, max = DETAIL_CHARS): string => {
    const flat = text.replace(/\s+/g, " ").trim()
    return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** Sentence case with a full stop, so describers can compose phrases without minding punctuation. */
export const asSentence = (text: string): string => {
    const trimmed = text.trim()
    if (!trimmed) return ""
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/** `file_path` → `File path`. Field names are the only labels an unregistered payload gives us. */
export const fieldLabel = (field: string): string => {
    const words = field
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
    return words ? `${words[0].toUpperCase()}${words.slice(1).toLowerCase()}` : field
}

/** A scalar rendered for a human: strings as-is, arrays joined, everything else skipped. */
export const readableValue = (value: unknown): string | undefined => {
    if (typeof value === "string") return value.trim() || undefined
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (Array.isArray(value)) {
        const parts = value.filter((item) => typeof item === "string" || typeof item === "number")
        return parts.length === value.length && parts.length ? parts.join(", ") : undefined
    }
    return undefined
}

/** A machine-written id segment: a UUID, or a bare hash. Deliberately narrow — a folder a PERSON
 * named ("2024-reports", "v2-migration") must never be mistaken for plumbing and hidden. */
const isOpaqueId = (segment: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{32,}$/i.test(segment)

/**
 * A sandbox path as a person can read it: the run's own root dropped, and the runner's id segments
 * folded to an ellipsis (#6349).
 *
 * `drivePathFromToolPath` is the same helper the Files drawer resolves a tool path with, so the
 * card and the drive agree on what a path names. It returns null for a path under NO sandbox root
 * (`/etc/hosts`) — that one shows verbatim, because a read outside the workspace is precisely the
 * detail an approval must not soften.
 */
export const displayPath = (value: string): string => {
    const drive = drivePathFromToolPath(value)
    if (!drive) return value
    const kept: string[] = []
    for (const segment of drive.path.split("/")) {
        if (!isOpaqueId(segment)) kept.push(segment)
        // A run of ids collapses to one gap rather than a row of them.
        else if (kept[kept.length - 1] !== "…") kept.push("…")
    }
    return kept.join("/") || drive.path
}

/**
 * The name a sentence calls a file by: its folder and its name, the pair the drive cards show.
 *
 * A path OUTSIDE the workspace keeps every segment. Taking the tail of `/home/me/.ssh/id_rsa` would
 * say "reading .ssh/id_rsa" — a file the agent reached outside its sandbox, worded exactly like one
 * of the project's own. The sentence is the part that gets read; it is the last place to shorten a
 * path whose location is the whole reason to ask.
 *
 * Named apart from `fieldLabel` above on purpose: they differ by one letter and mean nothing alike.
 */
export const fileTarget = (path: string): string => {
    if (!drivePathFromToolPath(path)) return path
    const parts = displayPath(path).split("/").slice(-2)
    // An elided parent is dropped — "SKILL.md" says more than "…/SKILL.md".
    return (parts.length === 2 && parts[0] === "…" ? parts.slice(1) : parts).join("/")
}

/** One row per readable field, labelled by its name. Nested objects are skipped, never stringified.
 *
 * `resolvePath` is opt-in because the two callers mean different things by a path field: a harness
 * gate names a file in THIS sandbox, while a gateway tool's `path` argument addresses a third
 * party's storage, where stripping a leading `/agenta/mounts/...` would rewrite a real remote path. */
export const readableFieldRows = (
    input: unknown,
    {resolvePaths = false}: {resolvePaths?: boolean} = {},
): {title: string; detail: string}[] => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return []
    const rows: {title: string; detail: string}[] = []
    for (const [field, value] of Object.entries(input as Record<string, unknown>)) {
        const readable = readableValue(value)
        if (!readable) continue
        const detail = resolvePaths && PATH_KEYS.includes(field) ? displayPath(readable) : readable
        rows.push({title: fieldLabel(field), detail: oneLine(detail)})
    }
    return rows
}
