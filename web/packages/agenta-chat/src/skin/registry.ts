/**
 * Skin registration store + resolvers.
 *
 * The store starts EMPTY. A skin (the desktop's `assets/toolDisplay.ts`, mobile's shadcn skin)
 * calls `registerChatSkin` to contribute client-tool widgets, approval bodies, and per-tool display
 * overrides.
 *
 * The tool-display half is more than a store: it is THE place a raw runtime tool name (AI SDK part)
 * becomes what the chat UI shows, for every host. Resolution order: registered override →
 * built-in default → name-shape heuristics (`mcp__…`/`mcp.…`, gateway double-underscore forms) →
 * argument-shape classifier (shell/file) → title-cased raw name. Grow `DEFAULT_TOOL_DISPLAY` for
 * platform special cases; nothing here is load-bearing for unknown tools, and raw names stay
 * reachable via tooltips and Build mode.
 */
import {parseGatewayToolName} from "@agenta/entities/workflow/commitDiff"

import type {
    ApprovalDescriber,
    ChatSkinRegistration,
    ClientToolMeta,
    ClientToolWidget,
    ResolvedToolDisplay,
    ToolActivity,
    ToolDisplayEntry,
    ToolKind,
} from "./types"

interface RegistrationStore {
    clientTools: {
        byRenderKind: Record<string, ClientToolWidget>
        byToolName: Record<string, ClientToolWidget>
    }
    approvals: Record<string, ApprovalDescriber>
    toolDisplay: Record<string, ToolDisplayEntry>
}

const store: RegistrationStore = {
    clientTools: {byRenderKind: {}, byToolName: {}},
    approvals: {},
    toolDisplay: {},
}

/**
 * Merge a skin's contribution into the shared store. Merge semantics: per key, the LATEST
 * registration wins (a later call's entry overwrites an earlier call's entry for the same key);
 * keys the new registration doesn't mention are left untouched. Registering `{}` or omitting a
 * sub-map is a no-op for that sub-map.
 */
export const registerChatSkin = (skin: ChatSkinRegistration): void => {
    if (skin.clientTools?.byRenderKind) {
        Object.assign(store.clientTools.byRenderKind, skin.clientTools.byRenderKind)
    }
    if (skin.clientTools?.byToolName) {
        Object.assign(store.clientTools.byToolName, skin.clientTools.byToolName)
    }
    if (skin.approvals) Object.assign(store.approvals, skin.approvals)
    if (skin.toolDisplay) {
        for (const [name, entry] of Object.entries(skin.toolDisplay)) {
            store.toolDisplay[name.toLowerCase()] = entry
        }
    }
}

/**
 * Resolve the widget for a client tool, or `undefined` when none is registered. Same precedence as
 * OSS `resolveClientToolHandler`: `render.kind` first (the finer dispatch axis), then `toolName`.
 */
export const resolveClientToolWidget = (
    meta: Pick<ClientToolMeta, "toolName" | "renderKind">,
    /** Built-ins to fall back on, passed as a VALUE by the dispatcher. See the note on
     * `clientToolWidgets` in @agenta/entity-ui: registration alone is a side effect and gets
     * tree-shaken across a `sideEffects: false` package boundary. */
    fallback?: ChatSkinRegistration["clientTools"],
): ClientToolWidget | undefined => {
    // An explicit `render.kind` is answered on that axis or not at all: reinterpreting an unknown
    // kind by tool name renders the wrong widget for a payload that deliberately asked for another.
    if (meta.renderKind !== undefined)
        return (
            store.clientTools.byRenderKind[meta.renderKind] ??
            fallback?.byRenderKind?.[meta.renderKind]
        )
    return store.clientTools.byToolName[meta.toolName] ?? fallback?.byToolName?.[meta.toolName]
}

/** Whether this client tool has a dedicated widget registered (used to route known tools in every
 * state, mirroring OSS `hasClientToolWidget`). */
export const hasClientToolWidget = (
    meta: Pick<ClientToolMeta, "toolName" | "renderKind">,
    fallback?: ChatSkinRegistration["clientTools"],
): boolean => resolveClientToolWidget(meta, fallback) !== undefined

/** The describer registered for a tool, or `undefined` when the generic one should run. */
export const resolveApprovalDescriber = (toolName: string): ApprovalDescriber | undefined =>
    store.approvals[toolName]

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const stringAt = (value: unknown): string | undefined =>
    typeof value === "string" && value ? value : undefined

/** A tool result, which reaches the FE either parsed or still JSON-encoded. */
const asRecord = (output: unknown): Record<string, unknown> | undefined => {
    if (isRecord(output)) return output
    if (typeof output !== "string" || !output.trim().startsWith("{")) return undefined
    try {
        const parsed: unknown = JSON.parse(output)
        return isRecord(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

/** The first capability `discover_tools` resolved to a tool. */
const firstCapability = (output: unknown): Record<string, unknown> | undefined => {
    const capabilities = asRecord(output)?.capabilities
    if (!Array.isArray(capabilities)) return undefined
    return capabilities.find(
        (capability) =>
            isRecord(capability) &&
            (stringAt(capability.integration) ||
                (isRecord(capability.tool) && stringAt(capability.tool.integration))),
    ) as Record<string, unknown> | undefined
}

/** The matched app and its tool's ACTION token — the same token a gateway wire name carries, so
 * both rows word it alike. One read: the result is large and both halves share a capability. */
const matchedTool = (output: unknown): {slug?: string; action?: string} => {
    const capability = firstCapability(output)
    if (!capability) return {}
    const tool = isRecord(capability.tool) ? capability.tool : undefined
    return {
        slug: stringAt(capability.integration) ?? (tool && stringAt(tool.integration)),
        action: tool && stringAt(tool.action),
    }
}

/** Our in-sandbox MCP server (runner: `INTERNAL_TOOL_MCP_SERVER_NAME`). */
const INTERNAL_MCP_SERVER = "agenta-tools"

/** How each harness wraps a tool of that server: Claude `mcp__<server>__`, Codex `mcp.<server>.`
 * (runner `client-tools.ts` strips the same two). */
const INTERNAL_MCP_PREFIXES = [`mcp__${INTERNAL_MCP_SERVER}__`, `mcp.${INTERNAL_MCP_SERVER}.`]

/** Our slug namespace. Unstripped, `__ag__request_input` derives "Requested an Ag input". */
const INTERNAL_SLUG_PREFIX = "__ag__"

/** Ops we ship, mirroring the SDK's `platform/op_catalog.py` plus the two client tools. A bare name
 * is ours only if listed: a reference tool carries the user's own workflow name, and the glossary
 * would rename THEIR nouns. A missing op still conjugates, so it costs plain wording, not wrong. */
const PLATFORM_OPS = new Set([
    "annotate_trace",
    "commit_revision",
    "create_schedule",
    "create_subscription",
    "discover_tools",
    "discover_triggers",
    "list_connections",
    "list_deliveries",
    "list_schedules",
    "list_subscriptions",
    "pause_schedule",
    "pause_subscription",
    "query_spans",
    "query_workflows",
    "read_config",
    "remove_schedule",
    "remove_subscription",
    "rename_agent",
    "rename_session",
    "request_connection",
    "request_input",
    "resume_schedule",
    "resume_subscription",
    "test_run",
    "test_subscription",
])

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
    for (const prefix of [...INTERNAL_MCP_PREFIXES, INTERNAL_SLUG_PREFIX]) {
        if (raw.startsWith(prefix)) return raw.slice(prefix.length) || raw
    }
    return raw
}

/** Special cases, keyed by lowercased canonical wire name. Platform ops are `verb_noun`, so the
 * verb table and glossary derive them — only the few whose derived text would be wrong are here. */
const DEFAULT_TOOL_DISPLAY: Record<string, ToolDisplayEntry> = {
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
    // A tool search reports which tool it landed on. That name is worth far more than the keywords
    // it searched with, which are model-written and shapeless.
    discover_tools: {app: (_input, output) => matchedTool(output)},
    // These two prompt the user, so they are written from the reader's side, not the agent's. The
    // running form says the run is blocked on the reader, which "Asking" left implicit.
    request_connection: {
        app: (input) => ({slug: isRecord(input) ? stringAt(input.integration) : undefined}),
        activity: (app) => ({
            running: `Waiting for you to connect ${app ?? "an app"}`,
            done: `Asked you to connect ${app ?? "an app"}`,
        }),
    },
    request_input: {
        activity: {running: "Waiting for your answers", done: "Asked you some questions"},
    },

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

/** Verb forms for `verb noun` tool names. Closed on purpose: an unknown verb keeps its plain
 * label rather than reading as "Getted". */
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
    discover: {running: "Searching for", done: "Searched for"},
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

/** Our internal nouns in the product's words, article included. Ours only: a Stripe subscription
 * is a subscription, not a trigger. */
const PLATFORM_TERMS: Record<string, string> = {
    // A session has exactly one agent, so it is "the agent", never "an agent".
    agent: "the agent",
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

/** Keeps "file" out of "googledrive" while letting "calendar" out of "googlecalendar". */
const SLUG_ECHO_MIN_LENGTH = 5

/** Whether a word names the app, by catalog word ("Google Calendar") or squashed slug. */
const appWordTest = (appName: string): ((word: string) => boolean) => {
    const appWords = new Set(appName.toLowerCase().split(/\s+/).filter(Boolean))
    const squashed = appName.toLowerCase().replace(/[^a-z0-9]/g, "")
    return (word) =>
        appWords.has(word) || (word.length >= SLUG_ECHO_MIN_LENGTH && squashed.includes(word))
}

const echoesApp = (object: string, appName: string): boolean =>
    object.toLowerCase().split(/\s+/).filter(Boolean).some(appWordTest(appName))

interface BuiltActivity {
    activity: ToolActivity
    /** Whether the app name ended up inside the sentence. When it did not, the chip must show it. */
    namedApp: boolean
}

const ARTICLES = new Set(["a", "an", "the"])

/** The verb in an action name and its object. Catalog actions are often noun-first
 * ("Events list"), and those read with no tense at all unless the tail is checked too. */
const splitVerb = (
    label: string,
    appName?: string,
): {verb: string; forms: ToolActivity; rest: string[]} | null => {
    const words = label.split(" ").filter(Boolean)
    if (!words.length) return null
    const first = words[0].toLowerCase()
    if (VERB_FORMS[first]) return {verb: first, forms: VERB_FORMS[first], rest: words.slice(1)}
    if (words.length < 2) return null
    const last = words[words.length - 1].toLowerCase()
    if (!VERB_FORMS[last]) return null
    // Title case gave the first word a capital only for leading the phrase, and mid-sentence that
    // is wrong. An app's own name is the exception, and it takes the catalog's spelling.
    const head = appName && appWordTest(appName)(first) ? appName : first
    return {verb: last, forms: VERB_FORMS[last], rest: [head, ...words.slice(1, -1)]}
}

/** Verbs a query may lend, so a run of searches is not eight identical rows. Read-only on
 * purpose: a query is what the agent looked for, so "send" would claim a send that never happened. */
const QUERY_VERBS = new Set(["discover", "fetch", "find", "get", "list", "query", "read", "search"])

/** The query's own verb and what follows it, when it leads with one we are willing to borrow. */
const lendVerb = (query: string): {forms: ToolActivity; object: string} | null => {
    const [head, ...rest] = query.split(" ")
    const key = head?.toLowerCase() ?? ""
    if (!QUERY_VERBS.has(key)) return null
    const forms = VERB_FORMS[key]
    const object = rest.join(" ").trim()
    if (!forms || !object) return null
    return {forms, object}
}

/** How much of a query survives beside a named app: it is keyword salad, worse the longer it runs. */
const QUERY_TAIL_WORDS = 2

/** Words that cannot end a phrase — a fixed cut lands on one often ("activities for"). */
const DANGLING_WORDS = new Set([
    "a",
    "an",
    "and",
    "at",
    "by",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
])

/** The query beside a named app: its own name dropped, then trimmed to a short qualifier. */
const qualifierFor = (query: string, appName: string): string => {
    const isAppWord = appWordTest(appName)
    const words = query.split(/\s+/).filter(Boolean)
    let start = 0
    while (start < words.length && isAppWord(words[start].toLowerCase())) start += 1
    const tail = words.slice(start, start + QUERY_TAIL_WORDS)
    while (tail.length && DANGLING_WORDS.has(tail[tail.length - 1].toLowerCase())) tail.pop()
    return tail.join(" ")
}

/** "Search issues" → "Searched GitHub issues" once the app is known; null when there is no known
 * verb. `ours` opts into the platform glossary. */
const conjugate = (
    label: string,
    ours: boolean,
    appName?: string,
    query?: string,
): BuiltActivity | null => {
    const split = splitVerb(label, appName)
    if (!split) return null
    const {forms, rest} = split
    const object = rest.join(" ").trim()
    const say = (phrase: string): ToolActivity => ({
        running: `${forms.running} ${phrase}`,
        done: `${forms.done} ${phrase}`,
    })
    // A search says what it looked for, so the query replaces the object entirely.
    if (query) {
        const lent = lendVerb(query)
        const verb = lent?.forms ?? forms
        const asked = lent?.object ?? query
        // Known app becomes the subject; until then the query is all the row has.
        const phrase = appName
            ? [appName, qualifierFor(asked, appName)].filter(Boolean).join(" ")
            : lent || / (for|through)$/.test(verb.done)
              ? asked
              : `for ${asked}`
        return {
            activity: {running: `${verb.running} ${phrase}`, done: `${verb.done} ${phrase}`},
            namedApp: Boolean(appName),
        }
    }
    if (!object) {
        return appName
            ? {activity: say(appName), namedApp: true}
            : {activity: forms, namedApp: false}
    }
    // A glossary term brings its own article and never takes an app name: it is ours.
    const term = ours ? PLATFORM_TERMS[object.toLowerCase()] : undefined
    if (term) return {activity: say(term), namedApp: false}
    // An article the action name already carries ("Create an issue") has to come off before the app
    // goes in front of the noun, or it lands mid-phrase ("Created GitHub an issue").
    const words = object.split(" ")
    const carried = ARTICLES.has(words[0]?.toLowerCase() ?? "")
    const noun = (carried ? words.slice(1) : words).join(" ")
    if (!noun) return {activity: say(object), namedApp: false}
    const app = appName && !echoesApp(noun, appName) ? appName : undefined
    // The app modifies the noun, so the article is chosen for whichever word now comes first.
    const phrase = app ? `${app} ${noun}` : noun
    const single = carried || (words.length === 1 && !noun.endsWith("s"))
    return {
        activity: say(single ? `${article(app ?? noun)} ${phrase}` : phrase),
        namedApp: Boolean(app),
    }
}

/** The integration slug the catalog keys on ("github"). `parseGatewayToolName` title-cases the
 * same token and loses it. */
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
    const normalized = text.trim().replace(/\s+/g, " ")
    if (normalized.length <= max) return normalized
    const points = Array.from(normalized)
    return points.length <= max ? normalized : `${points.slice(0, max).join("")}…`
}

interface ParsedShape {
    label: string
    source?: string
    sourceKey?: string
    kind: ToolKind
    activity?: BuiltActivity
}

const parseMcpName = (
    raw: string,
    ours: boolean,
    appName?: string,
    query?: string,
): ParsedShape => {
    const separator = raw.startsWith("mcp__") ? "__" : "."
    const parts = raw.split(separator).filter(Boolean)
    const tool = parts[parts.length - 1]
    const server = parts.length >= 3 ? parts[1] : undefined
    const serverLabel = server ? parseGatewayToolName(server).label : undefined
    const {label} = parseGatewayToolName(tool)
    return {
        label,
        source: serverLabel ? `${serverLabel} · MCP` : "MCP",
        // No sourceKey: an MCP server is not a tool-catalog integration, so there is nothing to
        // look up and the row must not pay for a query.
        kind: "mcp",
        activity:
            conjugate(label, ours, ours ? undefined : (appName ?? serverLabel), query) ?? undefined,
    }
}

/**
 * Family and wording from the wire name, or from the arguments where the name is not a name: Codex
 * records a shell call under its command and a read under an English sentence, because `otel.ts`
 * uses the ACP title as the identifier. `wrapped` marks our own MCP server, which opts into the
 * glossary — a bare name is ours too, a gateway or third-party MCP name never is.
 */
const parseShape = (raw: string, input: unknown, ours: boolean, appName?: string): ParsedShape => {
    const query = queryFor(input)
    const token = isTokenName(raw)
    if (token && /^mcp(__|\.)/.test(raw)) return parseMcpName(raw, ours, appName, query)
    if (token && raw.includes("__")) {
        const parsed = parseGatewayToolName(raw)
        return {
            label: parsed.label,
            source: parsed.source,
            sourceKey: parsed.source ? sourceKeyOf(raw) : undefined,
            kind: parsed.source ? "gateway" : "platform",
            activity: conjugate(parsed.label, false, appName ?? parsed.source, query) ?? undefined,
        }
    }
    // Codex titles a shell call with its command. Requiring the title to BE the command's first
    // word keeps a properly named tool that merely takes `command` from reading as a shell.
    const command = isRecord(input) && typeof input.command === "string" ? input.command : ""
    if (command && (!token || command.split(/\s+/)[0] === raw)) {
        return {
            label: "Command",
            kind: "shell",
            activity: {
                activity: {running: "Running a command", done: "Ran a command"},
                namedApp: false,
            },
        }
    }
    if (CODEX_READ_TITLE.test(raw)) {
        return {
            label: "File",
            kind: "file",
            activity: {activity: {running: "Reading a file", done: "Read a file"}, namedApp: false},
        }
    }
    if (CODEX_LIST_TITLE.test(raw)) {
        return {
            label: "Files",
            kind: "file",
            activity: {activity: {running: "Listing files", done: "Listed files"}, namedApp: false},
        }
    }
    if (!token) return {label: clamp(raw, 60), kind: "platform"}
    // No source to go on: a gateway action slug (`GITHUB_SEARCH_ISSUES`) and a reference tool's
    // workflow slug are the same shape here, so an unknown verb keeps its plain label either way.
    const {label} = parseGatewayToolName(raw)
    return {label, kind: "platform", activity: conjugate(label, ours, appName, query) ?? undefined}
}

/** The sandbox root every path in a session sits under. Machine-generated and identical on every
 * row, so it is pure noise; id-looking segments (8+ chars with a digit) go with it. */
const SANDBOX_ROOT = /\/tmp\/agenta[\w-]*\/(?:mounts\/)?(?:(?=[\w-]*\d)[\w-]{8,}\/)*/g

/** Drop the `/bin/bash -lc "…"` wrapper Codex adds, and only then its quotes: an unwrapped
 * command may legitimately end in one (`-name '*.md'`). */
const unwrapShell = (command: string): string => {
    const body = command.replace(/^\/bin\/[a-z]*sh\s+-\w+\s+/, "")
    if (body === command) return body
    const quote = body[0]
    if (quote !== '"' && quote !== "'") return body
    return body.slice(1, body.endsWith(quote) ? -1 : undefined)
}

/** A shell command as the agent ran it, minus the login-shell wrapper and the sandbox root. */
const shortCommand = (command: string): string =>
    clamp(unwrapShell(command).replace(SANDBOX_ROOT, ""), 48)

const basename = (path: string): string => path.split("/").filter(Boolean).pop() ?? path

/** Path-ish argument keys. Kept in step with `PATH_KEYS` in `@agenta/entities`'
 * `session/core/fileActivity.ts`, which reads the same argument for the file cards on this row. */
const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path", "filename", "target_file"]

/** Arguments naming what the call was looking for. */
const QUERY_KEYS = ["use_cases", "query", "keywords", "search"]

/** What the call was looking for, or "" when it was not a search. */
const queryFor = (input: unknown): string => {
    if (!isRecord(input)) return ""
    for (const key of QUERY_KEYS) {
        const text = queryText(input[key])
        if (text) return clamp(text, 48)
    }
    return ""
}

/** A query argument as one line: a plain string, or a list joined. */
const queryText = (value: unknown): string => {
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(", ")
    return ""
}

/** The short technical string beside the sentence: a command, or a filename. */
const toolDetail = (raw: string, input?: unknown): string | undefined => {
    if (isRecord(input)) {
        const command = input.command
        if (typeof command === "string" && command) return shortCommand(command)
        for (const key of PATH_KEYS) {
            const value = input[key]
            if (typeof value === "string" && value) return clamp(basename(value), 48)
        }
        // A regex is not prose, so it stays in the detail slot where monospace reads right.
        const pattern = input.pattern
        if (typeof pattern === "string" && pattern) return clamp(pattern, 48)
    }
    const read = CODEX_READ_TITLE.exec(raw)
    if (read) return clamp(basename(read[1]), 48)
    const list = CODEX_LIST_TITLE.exec(raw)
    if (list) return clamp(basename(list[1]), 48)
    return undefined
}

/** A registered activity as a `BuiltActivity`; only the app-naming form fills `namedApp`. */
const overrideActivity = (
    override: ToolDisplayEntry | undefined,
    ownApp?: string,
): BuiltActivity | null => {
    const activity = override?.activity
    if (!activity) return null
    if (typeof activity !== "function") return {activity, namedApp: false}
    return {activity: activity(ownApp), namedApp: Boolean(ownApp)}
}

/** How a tool another call merely *reported* reads. Read-only verbs only: the call found the
 * tool, it did not run it, so "Sent a Gmail email" would be a false claim. */
const reportedActivity = (action: string, appName: string): BuiltActivity | null => {
    const label = parseGatewayToolName(action).label
    const split = splitVerb(label, appName)
    if (!split || !QUERY_VERBS.has(split.verb)) return null
    return conjugate(label, false, appName)
}

/** A registration merges ONTO the built-in default field-wise, so a skin that overrides only the
 * summary keeps the default's wording rather than falling back to the parsed name. */
const lookupToolDisplay = (canonical: string): ToolDisplayEntry | undefined => {
    const key = canonical.toLowerCase()
    const base = DEFAULT_TOOL_DISPLAY[key]
    const registered = store.toolDisplay[key]
    if (!base) return registered
    if (!registered) return base
    return {...base, ...registered}
}

/**
 * Resolve display info for a raw runtime tool name. Pure and total — never throws.
 *
 * `input`/`output` are optional; callers wanting only a label may omit them. `appName` comes from
 * the catalog, which answers late: resolve once without it, look up `sourceKey`, resolve again.
 */
export const resolveToolDisplay = (
    raw: string,
    input?: unknown,
    appName?: string,
    output?: unknown,
): ResolvedToolDisplay => {
    // Canonical for the override lookup, raw for the shape: the same platform tool must get its
    // wording under every harness, while a third-party MCP tool still reads as an MCP tool.
    const canonical = canonicalToolName(raw)
    const override = lookupToolDisplay(canonical)
    // Our own tools carry no useful provenance — dropping the wrapper's chip makes one call read
    // identically under all three harnesses.
    const wrapped = canonical !== raw
    // Wrapped names are ours by construction; a bare name only if we ship it under that name.
    const ours = wrapped || PLATFORM_OPS.has(canonical.toLowerCase())
    // Until the catalog answers, the slug title-cased reads as a gateway name does ("Googlecalendar").
    const own = override?.app?.(input, output)
    const ownApp = own?.slug ? (appName ?? parseGatewayToolName(own.slug).label) : undefined
    const parsed = parseShape(raw, input, ours, appName)
    // A registered label/source overrides the parsed shape piecewise — the skin contract. The
    // built-in defaults never set either; they word a call through `activity` instead.
    const label = override?.label ?? parsed.label
    // Whichever sentence wins answers "is the app already in it?", which decides the chip.
    const built =
        overrideActivity(override, ownApp) ??
        (own?.action && appName ? reportedActivity(own.action, appName) : null) ??
        parsed.activity
    return {
        raw,
        kind: override?.kind ?? parsed.kind,
        label,
        source:
            override?.source ??
            (wrapped || built?.namedApp ? undefined : (appName ?? parsed.source)),
        sourceKey: own?.slug ?? (wrapped ? undefined : parsed.sourceKey),
        activity: built?.activity ?? {running: label, done: label},
        detail: toolDetail(raw, input),
        summary: override?.summary,
    }
}

/** A tool sentence dropped into prose ("…before running a command"): a gerund, so decapitalise. */
export const inSentence = (phrase: string): string =>
    phrase ? phrase.charAt(0).toLowerCase() + phrase.slice(1) : phrase
