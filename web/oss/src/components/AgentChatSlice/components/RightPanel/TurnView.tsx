import {useMemo, useState} from "react"

import {capturesForTrigger} from "@agenta/playground"
import {DownloadSimple} from "@phosphor-icons/react"
import type {UIMessage} from "ai"
import {Button} from "antd"
import {useAtomValue} from "jotai"

import {downloadText} from "@/oss/lib/helpers/fileManipulations"

import {sessionCapturesAtomFamily} from "../../state/turnCaptures"
import ContextTab from "../TurnInspector/ContextTab"
import {contextMarkdown, rawMarkdown, timelineMarkdown} from "../TurnInspector/dump"
import RawTab from "../TurnInspector/RawTab"
import TimelineTab from "../TurnInspector/TimelineTab"

type Tab = "timeline" | "context" | "raw"

const TABS: {value: Tab; label: string}[] = [
    {value: "timeline", label: "Timeline"},
    {value: "context", label: "Context"},
    {value: "raw", label: "Raw"},
]

/**
 * The "turn" view of the right panel: one assistant turn's Timeline / Context / Raw, driven by the
 * LIVE `useChat` messages passed down from `AgentConversation` (so it reflects streaming and the
 * exact rendered turn).
 *
 * FOLLOWUP(sessions,turn-records): make this records-driven so a turn can be inspected outside the
 * live chat (reopened/cross-device). Today it needs the in-memory `messages`; a records-backed
 * source (queryRecords → group by turn) would let it work without a mounted `useChat`. See
 * docs/designs/sessions/frontend-integration.md.
 */
const TurnView = ({
    sessionId,
    messages,
    assistantMessageId,
}: {
    sessionId: string
    messages: UIMessage[]
    assistantMessageId: string
}) => {
    const [tab, setTab] = useState<Tab>("timeline")

    // The whole round: the user message that started the turn, then the assistant turn.
    const round = useMemo<UIMessage[]>(() => {
        const idx = messages.findIndex((m) => m.id === assistantMessageId)
        if (idx < 0) return []
        const assistant = messages[idx]
        let user: UIMessage | null = null
        for (let i = idx - 1; i >= 0; i--) {
            if (messages[i]?.role === "user") {
                user = messages[i]
                break
            }
        }
        return user ? [user, assistant] : [assistant]
    }, [assistantMessageId, messages])

    const captures = useAtomValue(sessionCapturesAtomFamily(sessionId))
    const turnCaptures = useMemo(() => {
        const idx = messages.findIndex((m) => m.id === assistantMessageId)
        let triggerId: string | null = null
        for (let i = idx; i >= 0; i--) {
            if (messages[i]?.role === "user") {
                triggerId = messages[i].id
                break
            }
        }
        return capturesForTrigger(captures, triggerId)
    }, [assistantMessageId, messages, captures])

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* Horizontal tab bar — tabs on top so content gets the panel's full width. */}
            <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-[var(--ag-surface-divider)] px-2 py-1.5">
                {TABS.map((t) => {
                    const active = t.value === tab
                    return (
                        <Button
                            key={t.value}
                            type="text"
                            onClick={() => setTab(t.value)}
                            className={`!h-7 !rounded-md !px-2.5 !text-xs transition-colors ${
                                active
                                    ? "!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]"
                                    : "!text-[var(--ag-colorTextSecondary)] hover:!bg-[var(--ag-colorFillTertiary)] hover:!text-[var(--ag-colorText)]"
                            }`}
                        >
                            {t.label}
                        </Button>
                    )
                })}
                <Button
                    type="text"
                    size="small"
                    className="!ml-auto"
                    icon={<DownloadSimple size={14} />}
                    onClick={() => {
                        const markdown =
                            tab === "timeline"
                                ? timelineMarkdown(round, sessionId)
                                : tab === "context"
                                  ? contextMarkdown(turnCaptures, sessionId)
                                  : rawMarkdown(turnCaptures, sessionId)
                        downloadText(markdown, `turn-${sessionId.slice(0, 8)}-${tab}.md`)
                    }}
                    aria-label={`Download ${tab} as markdown`}
                    title="Download as markdown"
                />
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
                {tab === "timeline" ? <TimelineTab round={round} /> : null}
                {tab === "context" ? <ContextTab captures={turnCaptures} /> : null}
                {tab === "raw" ? <RawTab captures={turnCaptures} /> : null}
            </div>
        </div>
    )
}

export default TurnView
