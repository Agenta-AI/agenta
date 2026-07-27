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
import {stripLeadingSlashes, stripTrailingSlashes} from "./pathUtils"

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
