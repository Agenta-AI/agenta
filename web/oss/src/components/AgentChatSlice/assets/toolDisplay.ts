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
    /** A tool-catalog integration slug ("github"), when this tool has one. Look it up for the real
     * app name — the wire name only supports title case, which gets "Github" wrong. An MCP server
     * name is not a catalog slug, so MCP tools leave this unset. */
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
    kind?: ToolKind
    /** A function when the sentence names an app; it receives the app's real name, or undefined
     * before the catalog answers. */
    activity?: ToolActivity | ((appName?: string) => ToolActivity)
    /** Reads the app this call is about out of the call itself, for a tool whose app is named in
     * its arguments or in what came back rather than in its wire name. `action` is the gateway
     * ACTION token of a tool this one merely reported, worded as that tool's own row would word it. */
    app?: (input: unknown, output: unknown) => {slug?: string; action?: string}
    summary?: (input: unknown, output: unknown) => string | null
}

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

/**
 * The app `discover_tools` matched, and the ACTION half of that tool's name (`EVENTS_LIST`) — the
 * same token a gateway wire name carries, so the row describes the tool the way the row that later
 * runs it will. One read: the result is a large payload and both halves live in one capability.
 */
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

/** Our reserved workflow-slug namespace. A client tool streams under it (`__ag__request_input`),
 * where the generic parser reads "ag" as the app and derives "Requested an Ag input". */
const INTERNAL_SLUG_PREFIX = "__ag__"

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

/**
 * Whether naming the app would stutter ("Got Google Calendar calendar settings").
 *
 * Matches both spellings the name arrives in: the catalog's "Google Calendar" by word, and the
 * pre-catalog slug "Googlecalendar" by substring. Skipping is safe — the app moves to the chip.
 */
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

/**
 * The verb in an action name and what it acts on.
 *
 * Verb-first is the common shape ("Send message"), but plenty of catalog actions are noun-first
 * ("Events list", "Emails fetch"), which used to read with no tense at all.
 */
const splitVerb = (label: string): {verb: string; forms: ToolActivity; rest: string[]} | null => {
    const words = label.split(" ").filter(Boolean)
    if (!words.length) return null
    const first = words[0].toLowerCase()
    if (VERB_FORMS[first]) return {verb: first, forms: VERB_FORMS[first], rest: words.slice(1)}
    if (words.length < 2) return null
    const last = words[words.length - 1].toLowerCase()
    if (!VERB_FORMS[last]) return null
    // The label is title-cased, so its first word carries a capital it only had for leading the
    // phrase. Mid-sentence ("Checked Google Calendar Events") that capital is wrong.
    const rest = [words[0].toLowerCase(), ...words.slice(1, -1)]
    return {verb: last, forms: VERB_FORMS[last], rest}
}

/**
 * Verbs a search query may lend to the sentence, so a run of searches does not read as eight
 * identical rows: "list google calendar settings" becomes "Checked google calendar settings".
 *
 * Read-only on purpose. A query is what the agent looked for, not what it did — lending "send"
 * would have a row that only searched a catalog claim it sent something.
 */
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

/**
 * How much of a query survives beside a named app. The app carries the identity, so the rest is a
 * qualifier — and a model writes these as keyword salad ("events date range"), which reads worse
 * the longer it runs.
 */
const QUERY_TAIL_WORDS = 2

/** Words that cannot end a phrase. Cutting a keyword list at a fixed length lands on one often
 * enough ("activities for", "top stories of") that it is worth dropping them. */
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

/**
 * "Search issues" → "Searched issues", or "Searched GitHub issues" once the app is known. Null
 * when the leading word is not a known verb. `ours` opts into the platform glossary.
 */
const conjugate = (
    label: string,
    ours: boolean,
    appName?: string,
    query?: string,
): BuiltActivity | null => {
    const split = splitVerb(label)
    if (!split) return null
    const {forms, rest} = split
    const object = rest.join(" ").trim()
    const say = (phrase: string): ToolActivity => ({
        running: `${forms.running} ${phrase}`,
        done: `${forms.done} ${phrase}`,
    })
    // A search says what it looked for, so the query stands in for the object entirely:
    // "Searched for tools" + "send email" reads "Searched for send email". The verb carries its own
    // preposition where it has one ("Searched for", "Looked through"); otherwise add one.
    if (query) {
        const lent = lendVerb(query)
        const verb = lent?.forms ?? forms
        const asked = lent?.object ?? query
        // Once the app is known it becomes the subject and the query is trimmed to a qualifier;
        // until then the whole query is all the row has to show.
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
const parseShape = (
    raw: string,
    input: unknown,
    wrapped: boolean,
    appName?: string,
): ParsedShape => {
    const query = queryFor(input)
    const token = isTokenName(raw)
    if (token && /^mcp(__|\.)/.test(raw)) return parseMcpName(raw, wrapped, appName, query)
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
    // Codex titles a shell call with the command itself, so its "name" is not an identifier — the
    // one exception being a single-word command, where the title IS that word. Requiring that
    // keeps a properly named tool that merely takes a `command` argument from reading as a shell.
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
    // A bare identifier is a platform op as Pi sends it, so the glossary applies.
    const {label} = parseGatewayToolName(raw)
    return {label, kind: "platform", activity: conjugate(label, true, appName, query) ?? undefined}
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

/** A registered activity as a `BuiltActivity`: only the app-naming form puts the app in the
 * sentence, and only when it actually got one. */
const overrideActivity = (
    override: ToolDisplayOverride | undefined,
    ownApp?: string,
): BuiltActivity | null => {
    const activity = override?.activity
    if (!activity) return null
    if (typeof activity !== "function") return {activity, namedApp: false}
    return {activity: activity(ownApp), namedApp: Boolean(ownApp)}
}

/**
 * How a tool another call merely *reported* reads, derived from its ACTION token exactly as its own
 * row would derive it.
 *
 * Only read-only verbs are adopted, for the same reason a search query's verb is: the call found
 * the tool, it did not run it, so "Sent a Gmail email" would be a false claim.
 */
const reportedActivity = (action: string, appName: string): BuiltActivity | null => {
    const label = parseGatewayToolName(action).label
    const split = splitVerb(label)
    if (!split || !QUERY_VERBS.has(split.verb)) return null
    return conjugate(label, false, appName)
}

/**
 * Resolve display info for a raw runtime tool name. Pure and total — never throws.
 *
 * `input` and `output` are optional: callers that only need a label (traces, approvals, permission
 * prompts) may omit them and simply get no `detail` and no app.
 *
 * `appName` names the app inside the sentence ("Searched GitHub issues"). The tool catalog holds
 * the real name and answers asynchronously, so a caller resolves once without it, looks the app up
 * by `sourceKey`, then resolves again with it. Left out, the slug title-cased is used.
 */
export const resolveToolDisplay = (
    raw: string,
    input?: unknown,
    appName?: string,
    output?: unknown,
): ToolDisplay => {
    // Canonical for the override lookup, raw for the shape: the same platform tool must get its
    // wording under every harness, while a third-party MCP tool still reads as an MCP tool.
    const canonical = canonicalToolName(raw)
    const override = BY_TOOL_NAME[canonical.toLowerCase()]
    // Our own tools carry no useful provenance — dropping the wrapper's chip makes one call read
    // identically under all three harnesses.
    const wrapped = canonical !== raw
    // A tool that names its app in its own call. Until the catalog answers, the slug title-cased
    // reads the way a gateway name does ("Googlecalendar", then "Google Calendar"). The reported
    // action only earns a sentence once the catalog can spell that app, so it is read no sooner.
    const own = override?.app?.(input, output)
    const ownApp = own?.slug ? (appName ?? parseGatewayToolName(own.slug).label) : undefined
    const parsed = parseShape(raw, input, wrapped, appName)
    const label = parsed.label
    // Whichever sentence wins carries its own answer to "did the app end up inside it?", which is
    // what decides the chip.
    const built =
        overrideActivity(override, ownApp) ??
        (own?.action && appName ? reportedActivity(own.action, appName) : null) ??
        parsed.activity
    return {
        raw,
        kind: override?.kind ?? parsed.kind,
        label,
        source: wrapped || built?.namedApp ? undefined : (appName ?? parsed.source),
        sourceKey: own?.slug ?? (wrapped ? undefined : parsed.sourceKey),
        activity: built?.activity ?? {running: label, done: label},
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

/**
 * A tool sentence dropped into surrounding prose ("…before running a command"). The running form
 * is a gerund phrase, so it only needs its leading capital removed.
 */
export const inSentence = (phrase: string): string =>
    phrase ? phrase.charAt(0).toLowerCase() + phrase.slice(1) : phrase

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
