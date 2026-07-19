/**
 * ContextLens (build-spec §4.2) — the role-tagged message list, reconstructed from the durable
 * records (cross-device), with message + approximate-token counts. A focused turn shows that
 * turn's window; no focus shows the whole running context.
 *
 * The reconstruction mirrors the MESSAGES ARRAY the model works with: user/assistant messages,
 * the assistant's TOOL CALLS (with their full input — a file write's content lives here and is a
 * big part of the token budget), and tool results. `thought`/lifecycle events are excluded — agent
 * reasoning isn't re-fed as context in most harnesses (e.g. Claude strips thinking blocks), and
 * counting it would inflate the estimate. The exact request-time param snapshot is a live-only
 * capture (phase-2), noted, not blocking.
 */
import {useMemo, useState} from "react"

import {sessionRecordsQueryFamily} from "@agenta/entities/session"
import {Segmented, Skeleton, Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import Markdown from "../../../assets/markdown"
import {buildTimeline, type TimelineEvent} from "../timeline"

type Role = "system" | "user" | "assistant" | "tool_call" | "tool"

const ROLE_META: Record<Role, {color: string}> = {
    system: {color: "default"},
    user: {color: "geekblue"},
    assistant: {color: "green"},
    tool_call: {color: "blue"},
    tool: {color: "cyan"},
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v))

interface ContextMessage {
    role: Role
    text: string
    /** Tool name for a `tool_call` entry. */
    toolName?: string
}

/** Reconstruct the model-context messages from timeline events (the messages array the model sees). */
function toMessages(events: TimelineEvent[]): ContextMessage[] {
    const out: ContextMessage[] = []
    for (const e of events) {
        const p = isRecord(e.payload) ? e.payload : {}
        if (e.type === "message") {
            const text = typeof p.text === "string" ? p.text : ""
            out.push({role: e.source === "user" ? "user" : "assistant", text})
        } else if (e.type === "tool_call") {
            // The assistant's tool use — its INPUT (a write's file content, etc.) is in the window
            // and is often the bulk of the tokens, so include it fully (counted below).
            const name = typeof p.name === "string" ? p.name : ""
            const input = p.input !== undefined ? JSON.stringify(p.input, null, 2) : ""
            out.push({role: "tool_call", text: input, toolName: name})
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

/** One reconstructed context message card. */
const MessageCard = ({m}: {m: ContextMessage}) => (
    <div className="flex flex-col gap-1 rounded border border-solid border-colorBorderSecondary bg-colorFillTertiary p-2">
        <Tag color={ROLE_META[m.role].color} className="m-0 w-fit !text-[10px]">
            {m.role === "tool_call" ? `→ ${m.toolName || "tool"}` : m.role}
        </Tag>
        {m.role === "assistant" || m.role === "user" ? (
            <Markdown content={m.text} className="!text-xs" />
        ) : (
            // tool_call input / tool result — raw, mono, capped-height scroll (can be a whole file).
            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-colorTextSecondary">
                {m.text}
            </pre>
        )}
    </div>
)

export function ContextLens({
    sessionId,
    focusedTurn,
}: {
    sessionId: string
    focusedTurn?: number | null
}) {
    const query = useAtomValue(sessionRecordsQueryFamily(sessionId))
    // For a focused turn: default shows JUST that turn's messages; "Up to here" shows the CUMULATIVE
    // window as of that turn (turns 1..N) — the true context the model saw when generating it.
    const [cumulative, setCumulative] = useState(false)

    // Reacts to the panel scope selector + the cumulative toggle.
    const messages = useMemo(() => {
        const {turns} = buildTimeline(query.data)
        const scoped =
            focusedTurn == null
                ? turns
                : cumulative
                  ? turns.filter((t) => t.turn <= focusedTurn)
                  : turns.filter((t) => t.turn === focusedTurn)
        return toMessages(scoped.flatMap((t) => t.events))
    }, [query.data, focusedTurn, cumulative])

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
                No messages in this {focusedTurn != null ? "turn" : "session"} yet.
            </div>
        )

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-3 border-0 border-b border-solid border-colorSplit px-3 py-1.5 text-[11px] text-colorTextTertiary">
                <span>{messages.length} messages</span>
                <span>~{approxTokens(messages).toLocaleString()} tokens</span>
                <div className="ml-auto">
                    {focusedTurn != null ? (
                        <Tooltip
                            title="This turn = only this turn's messages. Up to here = the cumulative context window as of this turn (everything up to and including it)."
                            placement="bottomRight"
                            mouseEnterDelay={0.4}
                        >
                            <Segmented
                                size="small"
                                value={cumulative ? "upto" : "turn"}
                                onChange={(v) => setCumulative(v === "upto")}
                                options={[
                                    {label: "This turn", value: "turn"},
                                    {label: "Up to here", value: "upto"},
                                ]}
                            />
                        </Tooltip>
                    ) : (
                        <span className="text-colorTextQuaternary">running context</span>
                    )}
                </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                {messages.map((m, i) => (
                    <MessageCard key={i} m={m} />
                ))}
            </div>
        </div>
    )
}
