/**
 * Agent HTML apps — `app.json` manifest (lane 0 contract).
 *
 * The manifest marks a drive folder as an app and tells the host what to render and what the app
 * may touch. Parsing is tolerant on purpose: agents write these files, so a stray field must not
 * hide the app. Only the four things the host cannot guess are strict (`agenta_app`, `name`, a
 * flat `entry`, valid JSON).
 */

import type {GrantLevel} from "./protocol"

export interface AppManifest {
    agenta_app: 1
    name: string
    /** Emoji or short glyph shown next to the name. */
    icon?: string
    /** File rendered in the iframe; a bare filename in the app dir. Default `index.html`. */
    entry: string
    /** Starter the app came from, e.g. `board@1` or `agent:retro-board@2`. Stamped by `create_app`. */
    template?: string | null
    /** Access the app asks for. Default `read`; the host may still narrow it. */
    access: GrantLevel
    /** Data files (relative to the app dir) the app owns; `create_app --update` leaves them alone. */
    data?: string[]
    /** Config file (relative to the app dir) the app reads on boot. */
    config?: string
    /** Inject the kit CSS. Default true. */
    kit?: boolean
    /** Parsed, unused in v1: prompt the agent runs to refresh the data files. */
    refresh?: {prompt: string}
    /** Parsed, unused in v1: platform tools the app may call. */
    tools?: string[]
    /** Unknown top-level fields, preserved verbatim so a round-trip does not drop them. */
    extra?: Record<string, unknown>
}

export const APP_MANIFEST_FILENAME = "app.json"
export const APP_DEFAULT_ENTRY = "index.html"

const KNOWN_KEYS: ReadonlySet<string> = new Set([
    "agenta_app",
    "name",
    "icon",
    "entry",
    "template",
    "access",
    "data",
    "config",
    "kit",
    "refresh",
    "tools",
])

const isRecord = (x: unknown): x is Record<string, unknown> =>
    typeof x === "object" && x !== null && !Array.isArray(x)

const isStringArray = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((item) => typeof item === "string")

const isGrantLevel = (x: unknown): x is GrantLevel => x === "read" || x === "read-write"

/**
 * Parse the text of an `app.json`. Returns null when the folder is not an app (bad JSON, wrong
 * marker, no name, or an `entry` that leaves the app dir). Every optional field falls back to its
 * default or is dropped when malformed; unknown top-level fields land in `extra`.
 */
export function parseManifest(text: string): AppManifest | null {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return null
    }
    if (!isRecord(raw)) return null
    if (raw.agenta_app !== 1) return null
    if (typeof raw.name !== "string" || raw.name.trim() === "") return null

    let entry = APP_DEFAULT_ENTRY
    if (raw.entry !== undefined) {
        if (typeof raw.entry !== "string" || raw.entry === "") return null
        if (raw.entry.includes("/") || raw.entry.includes("\\") || raw.entry.includes(".."))
            return null
        entry = raw.entry
    }

    const manifest: AppManifest = {
        agenta_app: 1,
        name: raw.name,
        entry,
        access: isGrantLevel(raw.access) ? raw.access : "read",
        kit: typeof raw.kit === "boolean" ? raw.kit : true,
    }

    if (typeof raw.icon === "string") manifest.icon = raw.icon
    if (typeof raw.template === "string" || raw.template === null) manifest.template = raw.template
    if (isStringArray(raw.data)) manifest.data = raw.data
    if (typeof raw.config === "string") manifest.config = raw.config
    if (isStringArray(raw.tools)) manifest.tools = raw.tools
    if (isRecord(raw.refresh) && typeof raw.refresh.prompt === "string") {
        manifest.refresh = {prompt: raw.refresh.prompt}
    }

    const extra: Record<string, unknown> = {}
    let hasExtra = false
    for (const key of Object.keys(raw)) {
        if (KNOWN_KEYS.has(key)) continue
        extra[key] = raw[key]
        hasExtra = true
    }
    if (hasExtra) manifest.extra = extra

    return manifest
}

/**
 * True when a folder listing contains an `app.json` file directly (not in a subfolder). Entry
 * paths may be bare names or full paths; only the last segment is compared.
 */
export function isAppFolderListing(entries: {path: string; isFolder: boolean}[]): boolean {
    return entries.some((entry) => {
        if (entry.isFolder) return false
        const name = entry.path.split("/").pop()
        return name === APP_MANIFEST_FILENAME
    })
}
