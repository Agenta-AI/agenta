/**
 * ContextLens (build-spec §4.2) — the role-tagged message list, reconstructed from the durable
 * records (cross-device), with message + approximate-token counts. Turn scope = that turn's
 * window; Session = the whole running context. Records carry the user + agent messages and tool
 * results, which is what the model context is; the exact request-time parameter snapshot is a
 * live-only capture (not persisted as a record) — a phase-2 detail, noted, not blocking.
 */
import {useMemo} from "react"

import {sessionRecordsQueryFamily} from "@agenta/entities/session"
import {Skeleton, Tag} from "antd"
import {useAtomValue} from "jotai"

import Markdown from "../../../assets/markdown"
import type {InspectorScope} from "../state"
import {buildTimeline, type TimelineEvent} from "../timeline"

type Role = "system" | "user" | "assistant" | "tool"

const ROLE_META: Record<Role, {color: string}> = {
    system: {color: "default"},
    user: {color: "geekblue"},
    assistant: {color: "green"},
    tool: {color: "cyan"},
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v))

interface ContextMessage {
    role: Role
    text: string
}

/** Reconstruct the model-context messages from timeline events. */
function toMessages(events: TimelineEvent[]): ContextMessage[] {
    const out: ContextMessage[] = []
    for (const e of events) {
        const p = isRecord(e.payload) ? e.payload : {}
        if (e.type === "message") {
            const text = typeof p.text === "string" ? p.text : ""
            out.push({role: e.source === "user" ? "user" : "assistant", text})
        } else if (e.type === "tool_result") {
            const output =
                typeof p.output === "string"
                    ? p.output
                    : p.output != null
                      ? JSON.stringify(p.output)
                      : ""
            out.push({role: "tool", text: output})
        }
    }
    return out
}

/** Rough token estimate (~4 chars/token) — labelled approximate; no real tokenizer on the FE. */
const approxTokens = (messages: ContextMessage[]): number =>
    Math.round(messages.reduce((n, m) => n + m.text.length, 0) / 4)

export function ContextLens({
    sessionId,
    scope,
    targetTurn,
}: {
    sessionId: string
    scope: InspectorScope
    targetTurn?: number | null
}) {
    const query = useAtomValue(sessionRecordsQueryFamily(sessionId))

    const messages = useMemo(() => {
        const {turns} = buildTimeline(query.data)
        const scoped =
            scope === "turn" && targetTurn != null
                ? turns.filter((t) => t.turn === targetTurn)
                : turns
        return toMessages(scoped.flatMap((t) => t.events))
    }, [query.data, scope, targetTurn])

    if (query.isPending)
        return (
            <div className="p-3">
                <Skeleton active paragraph={{rows: 8}} />
            </div>
        )
    if (query.data === null || query.isError)
        return (
            <div className="p-4 text-xs text-colorTextTertiary">Couldn&rsquo;t load context.</div>
        )
    if (messages.length === 0)
        return (
            <div className="p-6 text-center text-xs text-colorTextTertiary">
                No messages in this {scope === "turn" ? "turn" : "session"} yet.
            </div>
        )

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-3 border-0 border-b border-solid border-[#2a2c30] px-3 py-1.5 text-[11px] text-colorTextTertiary">
                <span>{messages.length} messages</span>
                <span>~{approxTokens(messages).toLocaleString()} tokens</span>
                <span className="ml-auto text-colorTextQuaternary">
                    {scope === "turn" ? "this turn's window" : "running context"}
                </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                {messages.map((m, i) => (
                    <div
                        key={i}
                        className="flex flex-col gap-1 rounded border border-solid border-[#24262b] bg-[#0f1012] p-2"
                    >
                        <Tag color={ROLE_META[m.role].color} className="m-0 w-fit !text-[10px]">
                            {m.role}
                        </Tag>
                        {m.role === "assistant" || m.role === "user" ? (
                            <Markdown content={m.text} className="!text-xs" />
                        ) : (
                            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-colorTextSecondary">
                                {m.text}
                            </pre>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
