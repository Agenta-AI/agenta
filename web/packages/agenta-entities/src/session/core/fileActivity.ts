/**
 * Pure detection of file activity from a tool call: did this tool (by wire name + input) write,
 * edit, or delete a file, and which path? This is the primitive under the mid-stream drive
 * signals — the chat scans settled tool parts and feeds them through here; matches become
 * {@link SessionFileActivityEntry} signals in the state layer.
 *
 * Coverage is intentionally a registry, not a heuristic: Pi builtins (`write`/`edit`), Claude
 * Code tools (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`), and common MCP filesystem names.
 * `bash` is deliberately NOT matched — shell one-liners can touch anything, and a false "file
 * created" signal is worse than none (the turn-finish revalidation still catches the effect).
 */
import {stripLeadingSlashes, stripTrailingSlashes, trimSlashes} from "./pathUtils"

export type FileActivityOp = "write" | "edit" | "delete"

export interface FileActivity {
    op: FileActivityOp
    /** The path exactly as the tool received it — sandbox-absolute or cwd-relative. */
    path: string
    /** The wire tool name that produced the match. */
    toolName: string
}

// Wire names by op, matched case-insensitively on the name's tail segment (so
// `mcp__filesystem__write_file` matches "write_file"). Grow these sets as harnesses are added.
const WRITE_NAMES = new Set(["write", "write_file", "create_file", "save_file", "put_file"])
const EDIT_NAMES = new Set([
    "edit",
    "edit_file",
    "multiedit",
    "multi_edit",
    "notebookedit",
    "notebook_edit",
    "str_replace",
    "str_replace_editor",
    "apply_patch",
    "search_replace",
])
const DELETE_NAMES = new Set(["delete_file", "remove_file", "rm_file"])

// Input keys that carry the target path, across harness vocabularies (Pi `path`, Claude Code
// `file_path`/`notebook_path`, misc `filename`/`target_file`).
const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path", "filename", "target_file"]

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** `mcp__filesystem__write_file` → "write_file"; plain names pass through. */
const nameTail = (toolName: string): string => {
    const parts = toolName.split("__").filter(Boolean)
    return (parts[parts.length - 1] ?? toolName).toLowerCase()
}

const opForName = (toolName: string): FileActivityOp | null => {
    const tail = nameTail(toolName)
    if (WRITE_NAMES.has(tail)) return "write"
    if (EDIT_NAMES.has(tail)) return "edit"
    if (DELETE_NAMES.has(tail)) return "delete"
    return null
}

const pathFromInput = (input: unknown): string | null => {
    if (!isRecord(input)) return null
    for (const key of PATH_KEYS) {
        const value = input[key]
        if (typeof value === "string" && value.trim()) return value.trim()
    }
    return null
}

/** Detect file activity from one settled tool call. Pure and total — null when not file-ish. */
export function detectFileActivity(toolName: string, input: unknown): FileActivity | null {
    const op = opForName(toolName)
    if (!op) return null
    const path = pathFromInput(input)
    if (!path) return null
    return {op, path, toolName}
}

/**
 * Does a mount-relative file path correspond to a tool path? Tool paths are sandbox-absolute or
 * cwd-relative; mount listings are mount-root-relative — so match on the tail with a segment
 * boundary ("notes/a.md" matches "/tmp/agenta/x/notes/a.md" but not "xnotes/a.md").
 */
export function mountPathMatchesToolPath(mountPath: string, toolPath: string): boolean {
    const mount = stripLeadingSlashes(mountPath)
    const tool = stripTrailingSlashes(toolPath)
    if (!mount || !tool) return false
    if (tool === mount || tool.endsWith(`/${mount}`)) return true
    return false
}

/** Which mount an absolute tool path names, and where inside it. */
export interface DriveToolPath {
    /** `"agent"` = the durable per-agent mount (the runner's `<cwd>-agent` sibling); `"session"` =
     * the run's own cwd mount. */
    origin: "agent" | "session"
    /** The path relative to that mount's root — what a drive listing can actually resolve. */
    path: string
}

/** The runner names the agent's durable mount as the cwd's sibling (`agentMountPath`). */
const AGENT_MOUNT_SUFFIX = "-agent"

/** The generated workspace directories the runner creates when a run has no durable mount to sign
 * (`defaultLocalCwd` / `defaultDaytonaCwd`), longest first so the more specific one wins. */
const EPHEMERAL_ROOT_PREFIXES = ["agenta-sandbox-agent-", "agenta-"] as const

/** Machine-generated id: letters and digits only. Distinguishes the runner's `agenta-<hex>` scratch
 * dir from a checkout that merely starts the same way (`agenta-open-source`). */
const isGeneratedId = (s: string): boolean => s.length > 0 && /^[A-Za-z0-9]+$/.test(s)

const isEphemeralRoot = (segment: string): boolean => {
    const base = segment.endsWith(AGENT_MOUNT_SUFFIX)
        ? segment.slice(0, -AGENT_MOUNT_SUFFIX.length)
        : segment
    for (const prefix of EPHEMERAL_ROOT_PREFIXES) {
        if (base.startsWith(prefix)) return isGeneratedId(base.slice(prefix.length))
    }
    return false
}

/** Index one past the last segment of the sandbox workspace root, or -1 when these segments sit
 * under no root this build knows. */
function sandboxRootEnd(segments: readonly string[]): number {
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        if (segment === "agenta") {
            // Durable: `agenta[/<namespace>]/mounts/<project_id>/<mount_id>`. The namespace is the
            // optional per-deployment storage prefix (api `MountsService._storage_key`), so `mounts`
            // sits one or two segments in — bounded, so a user's own `mounts/` folder deeper in the
            // tree can never be mistaken for the root. Anything else under `agenta/` is runner IPC
            // (`relay/`, `telemetry/`, `tool-mcp/`), which names no drive file at all.
            const m =
                segments[i + 1] === "mounts" ? i + 1 : segments[i + 2] === "mounts" ? i + 2 : -1
            return m !== -1 && m + 2 < segments.length ? m + 3 : -1
        }
        if (isEphemeralRoot(segment)) return i + 1
    }
    return -1
}

/**
 * Turn a TOOL path into a path a drive can resolve.
 *
 * Tool paths come off the record log exactly as the harness received them: cwd-relative
 * (`notes/a.md`) or sandbox-ABSOLUTE (`/tmp/agenta/mounts/<project_id>/<mount_id>/notes/a.md`).
 * Only the relative form is a drive path. Presenting the absolute one verbatim shows the sandbox's
 * plumbing, exempts runner-internal files from the `agents/` filter, and — because a drive treats
 * it as mount-relative — browses to `<mount>/tmp/agenta/mounts/…`: an empty directory that never
 * existed, named with the ids of whichever run happened to write the file (#6270).
 *
 * The roots stripped here are the four the runner builds (`services/runner`, `environment-setup.ts`
 * and `run-plan.ts`):
 *
 *     durable   local     /tmp/agenta/mounts/<project_id>/<mount_id>
 *     durable   daytona   /home/sandbox/agenta/mounts/<project_id>/<mount_id>
 *     ephemeral local     /tmp/agenta-sandbox-agent-<rand>
 *     ephemeral daytona   /home/sandbox/agenta-<hex>
 *
 * The agent's durable mount is always the SIBLING `<cwd>-agent`, so a path under it belongs to the
 * agent mount rather than the cwd — hence {@link DriveToolPath.origin} rather than a bare string.
 *
 * Returns null when an absolute path sits under NO such root (`/etc/hosts`, the runner's own
 * `/tmp/agenta/relay/…`) or names the workspace root itself: those correspond to nothing in the
 * drive, and listing them as if they did is the bug this replaces.
 */
export function drivePathFromToolPath(toolPath: string): DriveToolPath | null {
    const trimmed = toolPath.trim()
    if (!trimmed) return null
    if (trimmed.charCodeAt(0) !== 47 /* "/" */) {
        // Already cwd-relative. A leading `./` is noise the drive would read as a folder name.
        const rel = stripTrailingSlashes(trimmed.startsWith("./") ? trimmed.slice(2) : trimmed)
        return rel ? {origin: "session", path: rel} : null
    }
    const segments = trimSlashes(trimmed).split("/")
    const rootEnd = sandboxRootEnd(segments)
    if (rootEnd === -1) return null
    const rest = segments.slice(rootEnd).filter(Boolean).join("/")
    if (!rest) return null
    return {
        origin: segments[rootEnd - 1].endsWith(AGENT_MOUNT_SUFFIX) ? "agent" : "session",
        path: rest,
    }
}

/**
 * Durable per-file recency from the session RECORD log (write/edit tool events), keyed by the
 * tool path with its newest timestamp. Unlike the live browser file-activity log (this tab's
 * observations only), records are the backend's durable stream — so this survives reload and is
 * consistent across devices, which is what makes "newest file first" correct everywhere.
 *
 * Records are the entities `SessionRecord` shape (post-transform): a tool call carries
 * `session_update === "tool_call"` and `payload` = the ACP event `{name, input}`; `created_at`
 * is the ingest timestamp. Deletes are ignored (a deleted file won't be in the listing anyway).
 */
export function fileRecencyFromRecords(
    records:
        | {
              session_update?: string | null
              payload?: unknown
              created_at?: string | null
          }[]
        | null
        | undefined,
): Map<string, number> {
    const recency = new Map<string, number>()
    for (const record of records ?? []) {
        if (record.session_update !== "tool_call") continue
        const payload = isRecord(record.payload) ? record.payload : null
        const name = typeof payload?.name === "string" ? payload.name : ""
        const activity = detectFileActivity(name, payload?.input)
        if (!activity || activity.op === "delete") continue
        const at = record.created_at ? Date.parse(record.created_at) : NaN
        if (Number.isNaN(at)) continue
        const prev = recency.get(activity.path) ?? 0
        if (at > prev) recency.set(activity.path, at)
    }
    return recency
}
