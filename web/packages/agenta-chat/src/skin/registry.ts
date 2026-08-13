/**
 * Skin registration store + resolvers (WP3a-C5).
 *
 * The store starts EMPTY. The OSS registries (`clientTools/registry.tsx`, `approvals/registry.tsx`,
 * `assets/toolDisplay.ts`) remain the desktop chat's own store — byte-untouched, per the plan's
 * COPY-mode banner — until the desktop re-plumb PR switches them onto `registerChatSkin`. Until
 * then, only a skin that calls `registerChatSkin` (mobile shadcn first, WP3b) populates any entry
 * here; nothing in this package calls it.
 */
import {parseGatewayToolName} from "@agenta/entities/workflow/commitDiff"

import type {
    ApprovalBodyEntry,
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
    approvals: Record<string, ApprovalBodyEntry>
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
    if (skin.toolDisplay) Object.assign(store.toolDisplay, skin.toolDisplay)
}

/**
 * Resolve the widget for a client tool, or `undefined` when none is registered. Same precedence as
 * OSS `resolveClientToolHandler`: `render.kind` first (the finer dispatch axis), then `toolName`.
 */
export const resolveClientToolWidget = (
    meta: Pick<ClientToolMeta, "toolName" | "renderKind">,
): ClientToolWidget | undefined => {
    if (meta.renderKind && store.clientTools.byRenderKind[meta.renderKind]) {
        return store.clientTools.byRenderKind[meta.renderKind]
    }
    return store.clientTools.byToolName[meta.toolName]
}

/** Whether this client tool has a dedicated widget registered (used to route known tools in every
 * state, mirroring OSS `hasClientToolHandler`). */
export const hasClientToolWidget = (
    meta: Pick<ClientToolMeta, "toolName" | "renderKind">,
): boolean => resolveClientToolWidget(meta) !== undefined

/** Resolve the renderer for an approval, or `undefined` for the generic card (mirrors OSS
 * `resolveApprovalRenderer`, which returns `null` for the same miss). */
export const resolveApprovalBody = (toolName: string): ApprovalBodyEntry | undefined =>
    store.approvals[toolName]

// Copied verbatim from web/oss/src/components/AgentChatSlice/assets/toolDisplay.ts (2026-08-13);
// the OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it.
// Keep byte-parity if either side changes. (`parseGatewayToolName` itself is NOT copied — it
// already lives in `@agenta/entities/workflow/commitDiff`, an existing package dependency, and is
// imported directly above.)
// Adaptations: `resolveToolDisplay` below also lets a registered entry override `kind`
// (`override?.kind ?? parsed.kind`), which OSS now does too; and the platform-tool registry
// (OSS `BY_TOOL_NAME`) is the skin store here, so no wording table is copied.
const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

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

/** Builds the sentence, naming the app that ran it when one is known. */
type ActivityBuilder = (appName?: string) => ToolActivity

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
        if (!object) return appName ? say(appName) : forms
        // A glossary term brings its own article and never takes an app name: it is ours.
        const term = ours ? PLATFORM_TERMS[object.toLowerCase()] : undefined
        if (term) return say(term)
        // The app modifies the object ("GitHub issues"), so a singular object takes its article
        // from whichever word now comes first.
        const phrase = appName ? `${appName} ${object}` : object
        const bare = rest.length === 1 && !object.endsWith("s")
        return say(bare ? `${article(appName ?? object)} ${phrase}` : phrase)
    }
}

/**
 * The integration slug behind a gateway wire name, as the tool catalog keys it ("github").
 *
 * Mirrors `parseGatewayToolName`'s branches, which title-case the same token and so lose it. This
 * resolver is pure, so it reports the slug and leaves the catalog lookup to the rendering skin —
 * title case alone yields "Github".
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
    () =>
        activity

/** Our in-sandbox MCP server, wrapped as Claude `mcp__<server>__` / Codex `mcp.<server>.`. Only
 * a tool of ours may take the platform glossary. */
const INTERNAL_MCP_PREFIXES = ["mcp__agenta-tools__", "mcp.agenta-tools."]
const isInternalName = (raw: string): boolean =>
    INTERNAL_MCP_PREFIXES.some((prefix) => raw.startsWith(prefix))

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
 * Codex records shell calls under the command itself and file reads under an English sentence, so
 * those two are recognised by argument shape and title pattern instead. A bare identifier is a
 * platform op as Pi sends it, so the glossary applies there too; a gateway or third-party MCP name
 * is never ours.
 */
const parseShape = (raw: string, input?: unknown): ParsedShape => {
    const token = isTokenName(raw)
    if (token && /^mcp(__|\.)/.test(raw)) return parseMcpName(raw, isInternalName(raw))
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
 * Resolve display info for a raw runtime tool name. Pure and total — never throws. Reproduces the
 * OSS `resolveToolDisplay` fallback chain: a registered entry overrides
 * label/source/kind/activity/summary piecewise; anything it doesn't override falls back to the
 * shape heuristics above. `input` is optional — omit it and you simply get no `detail`.
 *
 * `appName` names the app inside the sentence ("Searched GitHub issues"). The tool catalog holds
 * the real name and answers asynchronously, so a skin resolves once without it, looks the app up
 * by `sourceKey`, then resolves again with it. Left out, the name parsed off the wire is used.
 */
export const resolveToolDisplay = (
    raw: string,
    input?: unknown,
    appName?: string,
): ResolvedToolDisplay => {
    const override = store.toolDisplay[raw]
    const parsed = parseShape(raw, input)
    const label = override?.label ?? parsed.label
    const app = appName ?? parsed.appName
    // Naming the app inside the sentence retires the chip; without a sentence the chip still
    // carries the provenance on its own.
    const folded = Boolean(parsed.activity && app && !override?.activity)
    return {
        raw,
        kind: override?.kind ?? parsed.kind,
        label,
        source: override?.source ?? (folded ? undefined : (appName ?? parsed.source)),
        sourceKey: parsed.sourceKey,
        activity: override?.activity ?? parsed.activity?.(app) ?? {running: label, done: label},
        detail: toolDetail(raw, input),
        summary: override?.summary,
    }
}
