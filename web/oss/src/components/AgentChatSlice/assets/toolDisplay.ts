/**
 * Tool-step display foundation: the one place a raw runtime tool name (AI SDK part) becomes what
 * the chat UI shows. Resolution order: per-tool registry override → name-shape heuristics
 * (`mcp__…`/`mcp.…`, gateway double-underscore forms) → argument-shape classifier (shell/file) →
 * title-cased raw name. Same dispatch idea as the approvals/clientTools registries — grow
 * BY_TOOL_NAME for special cases; nothing here is load-bearing for unknown tools. Raw names stay
 * reachable via tooltips and Build mode.
 */
import {parseGatewayToolName} from "@agenta/entities/workflow/commitDiff"
import type {ToolUIPart} from "ai"

/** Best-effort tool family, inferred from the wire-name shape and the call's arguments. */
export type ToolKind = "gateway" | "mcp" | "platform" | "shell" | "file"

/** The row's sentence in both tenses. The done form says what was attempted, never that it
 * worked — the status icon carries that. */
export interface ToolActivity {
    running: string
    done: string
}

export interface ToolDisplay {
    /** Humanized action label ("Fetch emails"). */
    label: string
    /** Where the tool comes from ("Gmail", "Linear · MCP"), derived from the name alone. */
    source?: string
    /** The integration slug ("github"). Look it up in the tool catalog for the real app name —
     * the wire name only supports title case, which gets "Github" wrong. */
    sourceKey?: string
    /** The wire name — always kept reachable (tooltips, Build mode, traces). */
    raw: string
    kind: ToolKind
    /** Plain-English sentence for the activity row. Falls back to `label` when none is known. */
    activity: ToolActivity
    /** Short technical detail for the row's secondary slot (a command, a filename). */
    detail?: string
    /** Friendly one-liner for a settled row; null/absent falls back to the generic summary. */
    summary?: (input: unknown, output: unknown) => string | null
}

interface ToolDisplayOverride {
    label?: string
    source?: string
    kind?: ToolKind
    activity?: ToolActivity
    summary?: (input: unknown, output: unknown) => string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** Our in-sandbox MCP server (runner: `INTERNAL_TOOL_MCP_SERVER_NAME`). */
const INTERNAL_MCP_SERVER = "agenta-tools"

/** How each harness wraps a tool of that server: Claude `mcp__<server>__`, Codex `mcp.<server>.`
 * (runner `client-tools.ts` strips the same two). */
const INTERNAL_MCP_PREFIXES = [`mcp__${INTERNAL_MCP_SERVER}__`, `mcp.${INTERNAL_MCP_SERVER}.`]

/**
 * The platform tool name behind a harness wrapper.
 *
 * Pi sends `commit_revision`; Claude exposes the same tool over MCP and sends
 * `mcp__agenta-tools__commit_revision`, Codex `mcp.agenta-tools.commit_revision`. Anything keyed
 * BY tool name must key on this, or one call behaves differently depending on the harness.
 *
 * Only OUR server is unwrapped. A third-party MCP tool keeps its full name, so it can never
 * collide with a platform tool of the same bare name. NOT for permission rules: those must match
 * the wire name verbatim (see `useAlwaysAllowTool`).
 */
export const canonicalToolName = (raw: string): string => {
    for (const prefix of INTERNAL_MCP_PREFIXES) {
        if (raw.startsWith(prefix)) return raw.slice(prefix.length) || raw
    }
    return raw
}

/**
 * Special cases, keyed by lowercased canonical wire name.
 *
 * Our platform ops are `verb_noun` (`create_schedule`, `query_spans`), so the verb table and the
 * glossary below derive their wording — a new op reads correctly with no entry here. Only the
 * three whose derived text would be wrong are listed, alongside the builtins each harness spells
 * differently (Claude `Read`, Pi `read`). Codex names its builtins in prose instead, so those land
 * in the classifier below rather than here.
 */
const BY_TOOL_NAME: Record<string, ToolDisplayOverride> = {
    // `commit_revision` derives fine; it is here only for the commit-message summary.
    commit_revision: {
        summary: (input) => {
            const commit =
                isRecord(input) && isRecord(input.workflow_revision)
                    ? input.workflow_revision
                    : null
            return typeof commit?.message === "string" && commit.message ? commit.message : null
        },
    },
    // "Tested a run" misses the point — the run IS the agent under test.
    test_run: {activity: {running: "Testing the agent", done: "Tested the agent"}},
    // These two prompt the user, so they are written from the reader's side, not the agent's.
    request_connection: {
        activity: {running: "Asking you to connect an app", done: "Asked you to connect an app"},
    },
    request_input: {activity: {running: "Asking you for details", done: "Asked you for details"}},

    // Harness builtins. Claude title-cases them, Pi lowercases them; the key is lowercased.
    bash: {kind: "shell", activity: {running: "Running a command", done: "Ran a command"}},
    edit: {kind: "file", activity: {running: "Editing a file", done: "Edited a file"}},
    find: {kind: "file", activity: {running: "Looking for files", done: "Looked for files"}},
    glob: {kind: "file", activity: {running: "Looking for files", done: "Looked for files"}},
    grep: {kind: "file", activity: {running: "Searching files", done: "Searched files"}},
    ls: {kind: "file", activity: {running: "Listing files", done: "Listed files"}},
    read: {kind: "file", activity: {running: "Reading a file", done: "Read a file"}},
    task: {activity: {running: "Running a sub-task", done: "Ran a sub-task"}},
    todowrite: {activity: {running: "Updating its task list", done: "Updated its task list"}},
    webfetch: {activity: {running: "Fetching a web page", done: "Fetched a web page"}},
    websearch: {activity: {running: "Searching the web", done: "Searched the web"}},
    write: {kind: "file", activity: {running: "Writing a file", done: "Wrote a file"}},
}

/**
 * Verb forms for external tool actions (`SEND_EMAIL`, `SEARCH_ISSUES`).
 *
 * Deliberately a closed list: an action whose leading word is missing here keeps its plain label,
 * so an unfamiliar verb reads as it does today instead of as "Getted".
 */
const VERB_FORMS: Record<string, ToolActivity> = {
    add: {running: "Adding", done: "Added"},
    annotate: {running: "Annotating", done: "Annotated"},
    archive: {running: "Archiving", done: "Archived"},
    assign: {running: "Assigning", done: "Assigned"},
    cancel: {running: "Cancelling", done: "Cancelled"},
    close: {running: "Closing", done: "Closed"},
    // Plain English beats the git term for a reader who never asked about revisions.
    commit: {running: "Saving", done: "Saved"},
    copy: {running: "Copying", done: "Copied"},
    create: {running: "Creating", done: "Created"},
    delete: {running: "Deleting", done: "Deleted"},
    discover: {running: "Looking for", done: "Searched for"},
    download: {running: "Downloading", done: "Downloaded"},
    fetch: {running: "Fetching", done: "Fetched"},
    find: {running: "Finding", done: "Found"},
    get: {running: "Getting", done: "Got"},
    list: {running: "Checking", done: "Checked"},
    move: {running: "Moving", done: "Moved"},
    open: {running: "Opening", done: "Opened"},
    pause: {running: "Pausing", done: "Paused"},
    post: {running: "Posting", done: "Posted"},
    query: {running: "Looking through", done: "Looked through"},
    read: {running: "Reading", done: "Read"},
    remove: {running: "Removing", done: "Removed"},
    rename: {running: "Renaming", done: "Renamed"},
    reply: {running: "Replying", done: "Replied"},
    request: {running: "Requesting", done: "Requested"},
    resume: {running: "Resuming", done: "Resumed"},
    run: {running: "Running", done: "Ran"},
    search: {running: "Searching", done: "Searched"},
    send: {running: "Sending", done: "Sent"},
    set: {running: "Setting", done: "Set"},
    start: {running: "Starting", done: "Started"},
    stop: {running: "Stopping", done: "Stopped"},
    test: {running: "Testing", done: "Tested"},
    update: {running: "Updating", done: "Updated"},
    upload: {running: "Uploading", done: "Uploaded"},
    write: {running: "Writing", done: "Wrote"},
}

/**
 * What our internal nouns are called in the product, article included.
 *
 * `create_subscription` is a trigger, `query_spans` reads runs, `read_config` reads the agent's
 * setup. Applied ONLY to our own tools — a gateway action like `stripe__CANCEL_SUBSCRIPTION` means
 * a real subscription and must never be renamed to "trigger".
 */
const PLATFORM_TERMS: Record<string, string> = {
    config: "the agent's setup",
    revision: "changes",
    session: "this chat",
    span: "a run",
    spans: "runs",
    subscription: "a trigger",
    subscriptions: "triggers",
    workflow: "an agent",
    workflows: "agents",
}

/** "an" before a vowel sound, near enough for a one-word object. */
const article = (word: string): string => ("aeiou".includes(word[0]?.toLowerCase()) ? "an" : "a")

/** Shortest object word allowed to match inside a run-together slug. Keeps "file" out of
 * "googledrive" while letting "calendar" out of "googlecalendar". */
const SLUG_ECHO_MIN_LENGTH = 5

/**
 * Whether the object already says which app this is, so naming the app would stutter: a Google
 * Calendar action on "calendar settings" would read "Got Google Calendar calendar settings".
 *
 * Two forms have to match, because the app name arrives spelled two ways. The catalog gives
 * "Google Calendar", where a whole-word check is enough. Before it answers we hold the title-cased
 * slug "Googlecalendar", where the words are run together and only a substring check finds them.
 *
 * Erring toward skipping is safe: the app then shows in the chip instead, so nothing is lost. A
 * near-miss like Gmail against "email" matches neither form and still reads "Sent a Gmail email",
 * which is redundant but not wrong.
 */
const echoesApp = (object: string, appName: string): boolean => {
    const words = object.toLowerCase().split(/\s+/).filter(Boolean)
    const appWords = new Set(appName.toLowerCase().split(/\s+/).filter(Boolean))
    const squashed = appName.toLowerCase().replace(/[^a-z0-9]/g, "")
    return words.some(
        (word) =>
            appWords.has(word) || (word.length >= SLUG_ECHO_MIN_LENGTH && squashed.includes(word)),
    )
}

interface BuiltActivity {
    activity: ToolActivity
    /** Whether the app name ended up inside the sentence. When it did not, the chip must show it. */
    namedApp: boolean
}

/** Builds the sentence, naming the app that ran it when one is known and it does not stutter. */
type ActivityBuilder = (appName?: string) => BuiltActivity

/**
 * Turn a `verb noun` label into both tenses, optionally naming the app: "Search issues" becomes
 * "Searched issues", or "Searched GitHub issues" once the app is known. Returns null when the
 * leading word is not a verb we know, so an unfamiliar action keeps its plain label instead of
 * reading as "Getted".
 *
 * `ours` opts into the platform glossary; leave it off for anything we did not name.
 */
const conjugate = (label: string, ours = false): ActivityBuilder | null => {
    const [head, ...rest] = label.split(" ")
    const forms = VERB_FORMS[head?.toLowerCase() ?? ""]
    if (!forms) return null
    const object = rest.join(" ").trim()
    const say = (phrase: string): ToolActivity => ({
        running: `${forms.running} ${phrase}`,
        done: `${forms.done} ${phrase}`,
    })
    return (appName) => {
        if (!object) {
            return appName
                ? {activity: say(appName), namedApp: true}
                : {activity: forms, namedApp: false}
        }
        // A glossary term brings its own article and never takes an app name: it is ours.
        const term = ours ? PLATFORM_TERMS[object.toLowerCase()] : undefined
        if (term) return {activity: say(term), namedApp: false}
        const app = appName && !echoesApp(object, appName) ? appName : undefined
        // The app modifies the object ("GitHub issues"), so a singular object takes its article
        // from whichever word now comes first.
        const phrase = app ? `${app} ${object}` : object
        const bare = rest.length === 1 && !object.endsWith("s")
        return {
            activity: say(bare ? `${article(app ?? object)} ${phrase}` : phrase),
            namedApp: Boolean(app),
        }
    }
}

/**
 * The integration slug behind a gateway wire name, as the tool catalog keys it ("github").
 *
 * Mirrors `parseGatewayToolName`'s branches, which title-case the same token and so lose it. The
 * catalog turns this into the real app name; title case alone yields "Github".
 */
const sourceKeyOf = (raw: string): string | undefined => {
    const parts = raw.split("__").filter(Boolean)
    if (parts[0] === "tools" && parts.length >= 4) return parts[2]
    if (parts.length >= 2) return parts[parts.length - 2]
    return undefined
}

/** Codex names its builtins in prose rather than with an identifier. */
const CODEX_READ_TITLE = /^Read file '(.+)'$/
const CODEX_LIST_TITLE = /^List files in '(.+)'$/

/** An identifier-shaped name, as opposed to Codex's prose titles and raw shell commands. */
const isTokenName = (raw: string): boolean => /^[\w.-]+$/.test(raw)

const clamp = (text: string, max: number): string => {
    const points = Array.from(text.trim().replace(/\s+/g, " "))
    return points.length <= max ? points.join("") : `${points.slice(0, max).join("")}…`
}

interface ParsedShape {
    label: string
    source?: string
    sourceKey?: string
    /** The app to name inside the sentence. Absent for our own tools and for the harness itself. */
    appName?: string
    kind: ToolKind
    activity?: ActivityBuilder
}

/** A fixed sentence, for the families whose wording never names an app. */
const fixed =
    (activity: ToolActivity): ActivityBuilder =>
    () => ({activity, namedApp: false})

const parseMcpName = (raw: string, ours: boolean): ParsedShape => {
    const separator = raw.startsWith("mcp__") ? "__" : "."
    const parts = raw.split(separator).filter(Boolean)
    const tool = parts[parts.length - 1]
    const server = parts.length >= 3 ? parts[1] : undefined
    const serverLabel = server ? parseGatewayToolName(server).label : undefined
    const {label} = parseGatewayToolName(tool)
    return {
        label,
        source: serverLabel ? `${serverLabel} · MCP` : "MCP",
        sourceKey: server,
        // Our own tools read as "Saved changes", never "Saved Agenta tools changes".
        appName: ours ? undefined : serverLabel,
        kind: "mcp",
        activity: conjugate(label, ours) ?? undefined,
    }
}

/**
 * Family and wording from the wire name plus, where the name is not a name, the call's arguments.
 *
 * Codex records shell calls under the command itself and file reads under an English sentence
 * (`otel.ts` uses the ACP title as the identifier), so those two are recognised by argument shape
 * and title pattern instead.
 *
 * `wrapped` says the name arrived under our own MCP server, which is what lets the platform
 * glossary apply to it. A bare name is ours too (Pi sends platform ops unwrapped); a gateway or
 * third-party MCP name never is.
 */
const parseShape = (raw: string, input: unknown, wrapped: boolean): ParsedShape => {
    const token = isTokenName(raw)
    if (token && /^mcp(__|\.)/.test(raw)) return parseMcpName(raw, wrapped)
    if (token && raw.includes("__")) {
        const parsed = parseGatewayToolName(raw)
        return {
            label: parsed.label,
            source: parsed.source,
            sourceKey: parsed.source ? sourceKeyOf(raw) : undefined,
            appName: parsed.source,
            kind: parsed.source ? "gateway" : "platform",
            activity: conjugate(parsed.label) ?? undefined,
        }
    }
    // Codex titles a shell call with the command itself, so its "name" is not an identifier — the
    // one exception being a single-word command, where the title IS that word. Requiring that
    // keeps a properly named tool that merely takes a `command` argument from reading as a shell.
    const command = isRecord(input) && typeof input.command === "string" ? input.command : ""
    if (command && (!token || command.split(/\s+/)[0] === raw)) {
        return {
            label: "Command",
            kind: "shell",
            activity: fixed({running: "Running a command", done: "Ran a command"}),
        }
    }
    if (CODEX_READ_TITLE.test(raw)) {
        return {
            label: "File",
            kind: "file",
            activity: fixed({running: "Reading a file", done: "Read a file"}),
        }
    }
    if (CODEX_LIST_TITLE.test(raw)) {
        return {
            label: "Files",
            kind: "file",
            activity: fixed({running: "Listing files", done: "Listed files"}),
        }
    }
    if (!token) return {label: clamp(raw, 60), kind: "platform"}
    // A bare identifier is a platform op as Pi sends it, so the glossary applies.
    const parsed = parseGatewayToolName(raw)
    return {
        ...parsed,
        appName: parsed.source,
        kind: parsed.source ? "gateway" : "platform",
        activity: conjugate(parsed.label, !parsed.source) ?? undefined,
    }
}

/** A shell command as the agent ran it, minus the login-shell wrapper Codex adds. */
const shortCommand = (command: string): string =>
    clamp(command.replace(/^\/bin\/[a-z]*sh\s+-\w+\s+/, "").replace(/^["']|["']$/g, ""), 48)

const basename = (path: string): string => path.split("/").filter(Boolean).pop() ?? path

/** Path-ish argument keys, in the order the harnesses prefer them. */
const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path"]

/**
 * The short technical string shown next to the sentence: the command for a shell call, the
 * filename for a read. Undefined for tools whose arguments say nothing at a glance.
 */
const toolDetail = (raw: string, input?: unknown): string | undefined => {
    if (isRecord(input)) {
        const command = input.command
        if (typeof command === "string" && command) return shortCommand(command)
        for (const key of PATH_KEYS) {
            const value = input[key]
            if (typeof value === "string" && value) return clamp(basename(value), 48)
        }
        const pattern = input.pattern
        if (typeof pattern === "string" && pattern) return clamp(pattern, 48)
    }
    const read = CODEX_READ_TITLE.exec(raw)
    if (read) return clamp(basename(read[1]), 48)
    const list = CODEX_LIST_TITLE.exec(raw)
    if (list) return clamp(basename(list[1]), 48)
    return undefined
}

/**
 * Resolve display info for a raw runtime tool name. Pure and total — never throws.
 *
 * `input` is optional: callers that only need a label (traces, approvals, permission prompts) may
 * omit it and simply get no `detail`.
 *
 * `appName` names the app inside the sentence ("Searched GitHub issues"). The tool catalog holds
 * the real name and answers asynchronously, so a caller resolves once without it, looks the app up
 * by `sourceKey`, then resolves again with it. Left out, the name parsed off the wire is used.
 */
export const resolveToolDisplay = (raw: string, input?: unknown, appName?: string): ToolDisplay => {
    // Canonical for the override lookup, raw for the shape: the same platform tool must get its
    // wording under every harness, while a third-party MCP tool still reads as an MCP tool.
    const canonical = canonicalToolName(raw)
    const override = BY_TOOL_NAME[canonical.toLowerCase()]
    // Our own tools carry no useful provenance — dropping the wrapper's chip makes one call read
    // identically under all three harnesses.
    const wrapped = canonical !== raw
    const parsed = parseShape(raw, input, wrapped)
    const label = override?.label ?? parsed.label
    const built = parsed.activity?.(appName ?? parsed.appName)
    // Naming the app inside the sentence retires the chip. When the sentence declines the app (it
    // would stutter) or there is no sentence at all, the chip still carries the provenance.
    const folded = Boolean(built?.namedApp && !override?.activity)
    return {
        raw,
        kind: override?.kind ?? parsed.kind,
        label,
        source: override?.source ?? (wrapped || folded ? undefined : (appName ?? parsed.source)),
        sourceKey: wrapped ? undefined : parsed.sourceKey,
        activity: override?.activity ?? built?.activity ?? {running: label, done: label},
        detail: toolDetail(raw, input),
        summary: override?.summary,
    }
}

/**
 * Longest call description we render, counted in CODE POINTS.
 *
 * The catalog caps the model at the same number, and JSON Schema `maxLength` counts code points
 * too, so both ends measure the same string the same way.
 */
export const CALL_DESCRIPTION_MAX_LENGTH = 500

export interface CallDescription {
    text: string
    /** True when the text was cut — the caller must show that it was. */
    truncated: boolean
}

/**
 * The agent's own note about a builder tool call (R12), read from the call's arguments.
 *
 * It rides in `input.description` because the runner strips it only at dispatch, so the recorded
 * call keeps it on both the live and the replay path. This is model text, never a fact.
 */
export const extractCallDescription = (input: unknown): CallDescription | null => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null
    const raw = (input as {description?: unknown}).description
    if (typeof raw !== "string") return null
    const text = raw.trim()
    if (!text) return null
    // Cut on code points, not UTF-16 units: `slice` at the cap can land inside a surrogate pair and
    // emit a lone half, which renders as a replacement character.
    const points = Array.from(text)
    if (points.length <= CALL_DESCRIPTION_MAX_LENGTH) return {text, truncated: false}
    return {text: points.slice(0, CALL_DESCRIPTION_MAX_LENGTH).join(""), truncated: true}
}

/** Wire name of a tool part. `dynamic-tool` carries it on `toolName`; typed parts encode it as
 * `tool-<name>`. */
export const partToolName = (part: ToolUIPart): string => {
    // `dynamic-tool` parts reach here via the grouping cast in AgentMessage but sit outside
    // ToolUIPart's static union — read `type` as a string.
    const type = part.type as string
    if (type === "dynamic-tool") {
        return (part as {toolName?: string}).toolName || "tool"
    }
    return type.replace(/^tool-/, "")
}
