import {useEffect} from "react"

import {getDisplayContent} from "@agenta/chat/assets"
import type {ConfigItemRef} from "@agenta/ui/view-stack"
import type {UIMessage} from "ai"
import {atom, useSetAtom} from "jotai"

import type {ConfigTab} from "../agent-layout/agentPanelState"

/**
 * The page context of a builder message (design D13, shared contract SC5): what the person looks
 * at when they press Send. Ids, keys and short names only, never content. The model reads it as
 * one context line before the person's words; the words stay the message the person sees
 * (`metadata.display_content`).
 */
export interface PageContext {
    /** The agent of the screen. Always sent. */
    agent: {id: string; name: string}
    /** The part of the page, while the page has one to give. */
    page?: PagePart
    /** An open view form has edits that are not applied to the agent yet. */
    has_unsaved_draft: boolean
}

/** The part of the page the Configuration content or page writes into `pageContextAtom`. */
export interface ConfigurationPagePart {
    kind: "configuration"
    tab: ConfigTab
    item?: {list: ConfigItemRef["list"]; key: string; name: string}
}

/**
 * The session the page shows. The builder reads the session id from `pageSessionIdAtom` itself;
 * the name is absent while it loads. The revision it runs on joins in task 44.1.
 */
export interface SessionPagePart {
    kind: "session"
    session: {id: string; name?: string}
}

export type PagePart = ConfigurationPagePart | SessionPagePart

/**
 * The page part, written by the page that shows it (the Configuration page writes its tab and
 * open item). The builder reads it when a message is sent; no prop carries it into the builder.
 */
export const pageContextAtom = atom<ConfigurationPagePart | null>(null)

/** Publishes the page part while the page that calls it is mounted and `page` is not null. */
export const usePublishPageContext = (page: ConfigurationPagePart | null) => {
    const setPage = useSetAtom(pageContextAtom)
    // Keyed by the value, not the object: a page rebuilds the object on every render.
    const key = page ? JSON.stringify(page) : null
    useEffect(() => {
        if (!key) return
        const value = JSON.parse(key) as ConfigurationPagePart
        setPage(value)
        // Only this page's value is cleared: a newer page may have written its own.
        return () =>
            setPage((current) => (current && JSON.stringify(current) === key ? null : current))
    }, [key, setPage])
}

/** What the page offers when the session row of the page session is in this state. */
export interface PageSessionState {
    id: string
    /** The row is still loading. */
    pending: boolean
    /** The stream row; null when the server has no row (a new session with no turn yet). */
    row: {name?: string | null} | null | undefined
}

/**
 * The page part of this moment: the Configuration part a page wrote, else the session the page
 * shows. A new session with no row yet gives none; a session whose row loads gives its id only.
 */
export const resolvePagePart = (
    configuration: ConfigurationPagePart | null,
    session: PageSessionState | null,
): PagePart | null => {
    if (configuration) return configuration
    if (!session) return null
    if (session.pending) return {kind: "session", session: {id: session.id}}
    if (!session.row) return null
    const name = session.row.name?.trim()
    return {kind: "session", session: {id: session.id, ...(name ? {name} : {})}}
}

/** One value per page part, so a removal can be tied to the page it was made on. */
export const pagePartKey = (page: PagePart | null): string | null => {
    if (!page) return null
    if (page.kind === "session") return `session:${page.session.id}`
    return `configuration:${page.tab}:${page.item ? `${page.item.list}:${page.item.key}` : ""}`
}

/**
 * The fixed start of the context line, with its format version. The line is the prefix, one
 * space and the context as JSON (JSON keeps any name on one line).
 */
export const CONTEXT_LINE_PREFIX = "[agenta page context v1]"

/** The text the model reads: the context line, a blank line, then the person's words. */
export const withContextLine = (context: PageContext, text: string): string =>
    `${CONTEXT_LINE_PREFIX} ${JSON.stringify(context)}\n\n${text}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/**
 * The context of a stored message, rebuilt from its model text and the words the person typed
 * (`display_content`). Only the part before the words is read, so typed words that look like
 * the prefix never count. Null when the text has no valid line of a known version.
 */
export const parseContextLine = (text: string, displayContent: string): PageContext | null => {
    if (!text.endsWith(displayContent)) return null
    const head = text.slice(0, text.length - displayContent.length)
    const line = head.endsWith("\n\n") ? head.slice(0, -2) : null
    if (!line?.startsWith(`${CONTEXT_LINE_PREFIX} `) || line.includes("\n")) return null
    let value: unknown
    try {
        value = JSON.parse(line.slice(CONTEXT_LINE_PREFIX.length + 1))
    } catch {
        return null
    }
    if (!isRecord(value) || !isRecord(value.agent)) return null
    const {id, name} = value.agent
    if (typeof id !== "string" || typeof name !== "string") return null
    // A page part of a shape this browser does not know is dropped; the agent part stays.
    const {page, ...rest} = value
    return (isPagePart(page) ? {...rest, page} : rest) as unknown as PageContext
}

const isPagePart = (page: unknown): page is PagePart => {
    if (!isRecord(page)) return false
    if (page.kind === "session")
        return (
            isRecord(page.session) &&
            typeof page.session.id === "string" &&
            (page.session.name === undefined || typeof page.session.name === "string")
        )
    if (page.kind !== "configuration" || typeof page.tab !== "string") return false
    if (page.item === undefined) return true
    return isRecord(page.item) && typeof page.item.name === "string"
}

const EDIT_MARKER = "\n\nUpdated user request ("

/**
 * The context of a sent message: its own line, or for an edited message (its text is the
 * original text, the line included, then the edit) the line of the original.
 */
export const parseSentContextLine = (text: string, displayContent: string): PageContext | null => {
    const own = parseContextLine(text, displayContent)
    if (own) return own
    // `editedExecutionText` (chat assets) keeps the original text and appends the edit after
    // this marker; only such a text reads the line of its original.
    const edit = text.indexOf(EDIT_MARKER)
    if (edit < 0 || !text.endsWith(displayContent)) return null
    const original = text.slice(0, edit)
    const end = original.indexOf("\n\n")
    return end < 0 ? null : parseContextLine(original, original.slice(end + 2))
}

/** The page context line of a stored or live user message, rebuilt from its text. */
export const sentContextOf = (message: UIMessage): PageContext | null => {
    const words = getDisplayContent(message)
    if (typeof words !== "string") return null
    const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
    return parseSentContextLine(text, words)
}
