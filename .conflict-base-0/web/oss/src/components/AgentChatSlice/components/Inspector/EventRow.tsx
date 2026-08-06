/**
 * EventRow — the one row atom across every lens (build-spec §5): dot(type) · index · label ·
 * type-chip · time · expand. Expanding reveals the record JSON inline with a copy affordance.
 * Time is a relative offset from turn start; tool events also show duration.
 */
import {useState} from "react"

import {CopyButton} from "@agenta/ui/components/presentational"
import {CaretRight} from "@phosphor-icons/react"
import {Tag} from "antd"

import {resolveToolDisplay} from "../../assets/toolDisplay"

import {EVENT_META, relOffset, toolDuration, type TimelineEvent} from "./timeline"

const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v))

/** The row's label: tool name for tool events, a truncated body for message/thought, else the
 * source. */
function eventLabel(event: TimelineEvent): string {
    const p = isRecord(event.payload) ? event.payload : {}
    if (event.type === "tool_call" || event.type === "tool_result") {
        const name = typeof p.name === "string" ? p.name : event.toolName
        if (name) return resolveToolDisplay(name).label
        return event.type === "tool_call" ? "Tool call" : "Tool result"
    }
    if (event.type === "message" || event.type === "thought") {
        const text = typeof p.text === "string" ? p.text.replace(/\s+/g, " ").trim() : ""
        if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text
    }
    if (event.type === "error") {
        const msg =
            typeof p.message === "string" ? p.message : typeof p.text === "string" ? p.text : ""
        return msg || "Run error"
    }
    return event.source ?? EVENT_META[event.type].chip
}

export function EventRow({
    event,
    timeLabel,
    durationLabel,
    /** Turn scope renders bodies inline by default; session scope truncates. */
    defaultExpanded = false,
}: {
    event: TimelineEvent
    timeLabel?: string
    durationLabel?: string
    defaultExpanded?: boolean
}) {
    const [open, setOpen] = useState(defaultExpanded)
    const meta = EVENT_META[event.type]
    const isError = event.type === "error" || (event.type === "tool_result" && hasError(event))
    const isInteraction = event.type === "interaction_request"
    // A user-sent message: the human's own turn. Differentiate at a glance without a new palette
    // hue — a "you" chip + a brighter tone (their input reads as highlighted vs the muted agent
    // grey). `record_source` rides on `event.source`.
    const isUser = event.type === "message" && event.source === "user"
    const USER_TONE = "var(--ag-colorText)"
    const dotColor = isError ? EVENT_META.error.dot : isUser ? USER_TONE : meta.dot
    const chipText = isUser ? "you" : meta.chip
    const json = JSON.stringify(event.payload ?? {}, null, 2)
    // Errors/interactions read as typed events IN PLACE (spec §4.1) — a left accent bar, not a
    // detached banner.
    const accent = isError
        ? EVENT_META.error.dot
        : isInteraction
          ? EVENT_META.interaction_request.dot
          : null

    return (
        <div
            className="border-0 border-b border-solid border-colorSplit last:border-b-0"
            style={
                accent
                    ? {boxShadow: `inset 2px 0 0 ${accent}`, background: `${accent}0d`}
                    : undefined
            }
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="group flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1.5 text-left hover:bg-colorFillTertiary"
            >
                <CaretRight
                    size={10}
                    weight="bold"
                    className={`shrink-0 text-colorTextQuaternary transition-transform ${open ? "rotate-90" : ""}`}
                />
                <span className="h-2 w-2 shrink-0 rounded-full" style={{background: dotColor}} />
                <span className="w-6 shrink-0 text-right font-mono text-[11px] text-colorTextQuaternary">
                    {event.index}
                </span>
                <span
                    className={`min-w-0 flex-1 truncate text-xs ${event.type === "thought" ? "italic text-colorTextSecondary" : ""} ${isUser ? "font-medium text-colorText" : ""}`}
                >
                    {eventLabel(event)}
                </span>
                <Tag
                    className="m-0 shrink-0 border-0 font-mono !text-[10px] leading-[16px]"
                    style={{background: "var(--ag-colorFillTertiary)", color: dotColor}}
                >
                    {chipText}
                </Tag>
                {durationLabel ? (
                    <span className="shrink-0 font-mono text-[10px] text-colorTextQuaternary">
                        {durationLabel}
                    </span>
                ) : null}
                {timeLabel ? (
                    <span className="w-12 shrink-0 text-right font-mono text-[10px] text-colorTextQuaternary">
                        {timeLabel}
                    </span>
                ) : null}
            </button>
            {open ? (
                <div className="relative px-2 pb-2 pl-[46px]">
                    <div className="absolute right-2 top-1 z-[1]">
                        <CopyButton text={json} />
                    </div>
                    <pre className="m-0 max-h-64 overflow-auto rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 font-mono text-[11px] leading-snug text-colorTextSecondary">
                        {json}
                    </pre>
                    {/* Approvals are actioned in the live chat dock (durable respond is deferred
                        backend-side); the inspector shows the request read-only. */}
                    {isInteraction ? (
                        <div className="mt-1 text-[10px] text-colorTextQuaternary">
                            Approvals are actioned in the chat.
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

function hasError(event: TimelineEvent): boolean {
    const p = isRecord(event.payload) ? event.payload : {}
    return p.status === "error" || p.state === "output-error" || Boolean(p.error)
}

/** A flat event list (the Session view, or one turn group's expanded events). */
export function EventList({
    events,
    turnStart,
}: {
    events: TimelineEvent[]
    turnStart: number | null
}) {
    // Pair tool_call→tool_result durations by call id.
    const callAt = new Map<string, number>()
    for (const e of events) {
        if (e.type === "tool_call" && isRecord(e.payload) && typeof e.payload.id === "string") {
            if (e.at != null) callAt.set(e.payload.id, e.at)
        }
    }
    return (
        <div className="flex flex-col">
            {events.map((event) => (
                <EventRow
                    key={event.id}
                    event={event}
                    timeLabel={relOffset(event.at, turnStart)}
                    durationLabel={durationFor(event, callAt)}
                    defaultExpanded={event.type === "message" || event.type === "thought"}
                />
            ))}
        </div>
    )
}

function durationFor(event: TimelineEvent, callAt: Map<string, number>): string {
    if (event.type !== "tool_result" || !isRecord(event.payload)) return ""
    const id = typeof event.payload.id === "string" ? event.payload.id : undefined
    const start = id ? callAt.get(id) : undefined
    return toolDuration(start ?? null, event.at)
}
