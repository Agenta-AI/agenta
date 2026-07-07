/**
 * Markdown dumps of the Session Inspector tabs — agent-pasteable bug reports: facts as bullet
 * lists, payloads in fenced JSON. The drawer's download icon fetches the active tab fresh and
 * downloads it, so a dump never depends on a tab having been opened/loaded first.
 */
import {downloadText} from "@/oss/lib/helpers/fileManipulations"
import {mdFence, mdHeader, mdJson} from "@/oss/lib/helpers/markdownDump"

import {fetchInteractions, fetchMounts, fetchRecords, fetchState, fetchStream} from "./api"

export type SessionInspectorTab = "streams" | "records" | "states" | "mounts" | "interactions"

// Fern under-declares `status` on streams/interactions (backend extra="allow"); read it loosely.
const statusCode = (entity: unknown): string | undefined =>
    (entity as {status?: {code?: string}}).status?.code

const field = (label: string, value: unknown): string =>
    `- ${label}: ${value == null ? "—" : `\`${String(value)}\``}`

const streamsMarkdown = (
    stream: Awaited<ReturnType<typeof fetchStream>>,
    sessionId: string,
): string => {
    const parts = [mdHeader("Session stream", sessionId)]
    if (!stream) {
        parts.push("_No stream row for this session._")
    } else {
        parts.push(
            [
                field("stream_id", stream.id),
                field("turn_id", stream.turn_id),
                field("status", statusCode(stream)),
            ].join("\n"),
        )
        parts.push(`flags:\n\n${mdFence(mdJson(stream.flags ?? {}), "json")}`)
    }
    return parts.join("\n\n") + "\n"
}

const recordsMarkdown = (
    result: Awaited<ReturnType<typeof fetchRecords>>,
    sessionId: string,
): string => {
    const records = result?.records ?? []
    const parts = [mdHeader("Session records", sessionId)]
    if (!records.length) parts.push("_No record events._")
    records.forEach((event) => {
        parts.push(
            [
                `## [${event.record_index ?? "—"}] ${event.record_source ?? "record"} — ${event.record_type ?? "?"}`,
                mdFence(mdJson(event.attributes ?? {}), "json"),
            ].join("\n\n"),
        )
    })
    return parts.join("\n\n") + "\n"
}

const statesMarkdown = (
    state: Awaited<ReturnType<typeof fetchState>>,
    sessionId: string,
): string => {
    const parts = [mdHeader("Session state", sessionId)]
    if (!state) {
        parts.push("_No durable state for this session._")
    } else {
        parts.push(
            [
                field("state_id", state.id),
                field("sandbox_id", state.sandbox_id),
                field("updated_at", state.updated_at),
            ].join("\n"),
        )
        parts.push(`data:\n\n${mdFence(mdJson(state.data ?? {}), "json")}`)
    }
    return parts.join("\n\n") + "\n"
}

const mountsMarkdown = (
    result: Awaited<ReturnType<typeof fetchMounts>>,
    sessionId: string,
): string => {
    const mounts = result?.mounts ?? []
    const parts = [mdHeader("Session mounts", sessionId)]
    if (!mounts.length) parts.push("_No mounts bound to this session._")
    else
        parts.push(
            mounts
                .map((mount) => `- ${mount.name ?? mount.slug ?? mount.id} — \`${mount.id}\``)
                .join("\n"),
        )
    return parts.join("\n\n") + "\n"
}

const interactionsMarkdown = (
    result: Awaited<ReturnType<typeof fetchInteractions>>,
    sessionId: string,
): string => {
    const interactions = result?.interactions ?? []
    const parts = [mdHeader("Session interactions", sessionId)]
    if (!interactions.length) parts.push("_No interactions for this session._")
    interactions.forEach((interaction) => {
        const sections = [
            `## ${interaction.kind ?? "interaction"} — ${statusCode(interaction) ?? "unknown"}`,
            [
                field("token", interaction.token),
                field("turn_id", interaction.turn_id),
                field("created_at", interaction.created_at),
            ].join("\n"),
        ]
        if (interaction.data?.request)
            sections.push(`request:\n\n${mdFence(mdJson(interaction.data.request), "json")}`)
        if (interaction.data?.resolution)
            sections.push(`resolution:\n\n${mdFence(mdJson(interaction.data.resolution), "json")}`)
        parts.push(sections.join("\n\n"))
    })
    return parts.join("\n\n") + "\n"
}

/** Fetch the tab's data fresh and download it as markdown. Throws on fetch failure. */
export const dumpSessionTab = async (
    tab: SessionInspectorTab,
    sessionId: string,
    projectId?: string | null,
): Promise<void> => {
    let markdown: string
    switch (tab) {
        case "streams":
            markdown = streamsMarkdown(await fetchStream(sessionId, projectId), sessionId)
            break
        case "records":
            markdown = recordsMarkdown(await fetchRecords(sessionId, projectId), sessionId)
            break
        case "states":
            markdown = statesMarkdown(await fetchState(sessionId, projectId), sessionId)
            break
        case "mounts":
            markdown = mountsMarkdown(await fetchMounts(sessionId, projectId), sessionId)
            break
        case "interactions":
            markdown = interactionsMarkdown(
                await fetchInteractions(sessionId, projectId),
                sessionId,
            )
            break
    }
    downloadText(markdown, `session-${sessionId.slice(0, 8)}-${tab}.md`)
}
