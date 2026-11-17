/**
 * Text helpers shared by the approval describers and the generic preview. A leaf module so the
 * describers and `approvalPreview` can both use it without importing each other.
 */
import {AGENT_FILES_DIR, driveDir, DRIVES_DIR, presentToolPath} from "@agenta/entities/drive"
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

/** A UUID or bare hash. Narrow on purpose: a folder someone named ("2024-reports") must survive. */
const isOpaqueId = (segment: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{32,}$/i.test(segment)

/** A tool path as the files pane presents it: the home drive under `agent-files/`, another drive
 * under `drives/<slug>/` (also when the tool reached it through the session folder's link). */
const presentedPath = (value: string, homeSlug: string | null): string | null => {
    const tool = drivePathFromToolPath(value)
    if (!tool) return null
    const path = presentToolPath(tool, homeSlug)
    const homeDir = homeSlug ? `${driveDir(homeSlug)}/` : null
    return homeDir && path.startsWith(homeDir)
        ? `${AGENT_FILES_DIR}/${path.slice(homeDir.length)}`
        : path
}

/** A sandbox path a person can read: run root dropped, id segments elided (#6349), a drive's file
 * under its drive folder. A path under no sandbox root (`/etc/hosts`) stays verbatim; an approval
 * must not soften that. */
export const displayPath = (value: string, homeSlug: string | null = null): string => {
    const path = presentedPath(value, homeSlug)
    if (path === null) return value
    const kept: string[] = []
    for (const segment of path.split("/")) {
        if (!isOpaqueId(segment)) kept.push(segment)
        // A run of ids collapses to one gap rather than a row of them.
        else if (kept[kept.length - 1] !== "…") kept.push("…")
    }
    return kept.join("/") || path
}

/** The drive folder a presented path starts with (`agent-files`, `drives/<slug>`), if any. */
const driveFolderOf = (parts: readonly string[]): number =>
    parts[0] === AGENT_FILES_DIR ? 1 : parts[0] === DRIVES_DIR && parts.length > 2 ? 2 : 0

/** Folder + name, as the drive cards show it, after the drive folder when the file is in a drive.
 * A path outside the workspace keeps every segment: "reading .ssh/id_rsa" would word an escape
 * from the sandbox like a project file. */
export const fileTarget = (path: string, homeSlug: string | null = null): string => {
    if (!drivePathFromToolPath(path)) return path
    const all = displayPath(path, homeSlug).split("/")
    const folder = driveFolderOf(all)
    const parts = all.slice(folder).slice(-2)
    // An elided parent is dropped — "SKILL.md" says more than "…/SKILL.md".
    const tail = parts.length === 2 && parts[0] === "…" ? parts.slice(1) : parts
    return [...all.slice(0, folder), ...tail].join("/")
}

/** One row per readable field, labelled by its name. Nested objects are skipped, never stringified.
 * `resolvePaths` is opt-in: a gateway tool's `path` addresses a third party's storage, not this sandbox. */
export const readableFieldRows = (
    input: unknown,
    {
        resolvePaths = false,
        homeSlug = null,
    }: {resolvePaths?: boolean; homeSlug?: string | null} = {},
): {title: string; detail: string}[] => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return []
    const rows: {title: string; detail: string}[] = []
    for (const [field, value] of Object.entries(input as Record<string, unknown>)) {
        const readable = readableValue(value)
        if (!readable) continue
        const detail =
            resolvePaths && PATH_KEYS.includes(field) ? displayPath(readable, homeSlug) : readable
        rows.push({title: fieldLabel(field), detail: oneLine(detail)})
    }
    return rows
}
