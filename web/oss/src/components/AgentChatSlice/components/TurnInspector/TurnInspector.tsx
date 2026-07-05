import {useMemo, useState} from "react"

import {capturesForTrigger} from "@agenta/playground"
import {Button} from "@agenta/primitive-ui/components/button"
import {X} from "@phosphor-icons/react"
import type {UIMessage} from "ai"
import {useAtom, useAtomValue} from "jotai"

import {sessionCapturesAtomFamily} from "../../state/turnCaptures"
import {turnInspectorAtom} from "../../state/turnInspector"

import ContextTab from "./ContextTab"
import RawTab from "./RawTab"
import TimelineTab from "./TimelineTab"

type Tab = "timeline" | "context" | "raw"

const TABS: {value: Tab; label: string}[] = [
    {value: "timeline", label: "Timeline"},
    {value: "context", label: "Context"},
    {value: "raw", label: "Raw"},
]

const PANEL_WIDTH = 400

/**
 * Dedicated Build-mode turn inspector. Mounted per session inside `AgentConversation` so it reads
 * the LIVE `useChat` `messages` (the same list the transcript renders) — accurate turn + live
 * streaming — and opens ONLY for the session that is the current inspector target. Rendered as an
 * inline side panel (a flex sibling of the chat column) so it pushes the transcript aside instead of
 * overlaying it. Horizontal Timeline/Context/Raw tab bar on top so the content spans the panel's
 * full width (a vertical rail left the tool I/O JSON too narrow). Own state (`turnInspectorAtom`),
 * NOT the trace drawer.
 */
const TurnInspector = ({sessionId, messages}: {sessionId: string; messages: UIMessage[]}) => {
    const [target, setTarget] = useAtom(turnInspectorAtom)
    const [tab, setTab] = useState<Tab>("timeline")

    const open = target?.sessionId === sessionId

    // The whole round: the user message that started the turn, then the assistant turn.
    const round = useMemo<UIMessage[]>(() => {
        if (!open || !target) return []
        const idx = messages.findIndex((m) => m.id === target.assistantMessageId)
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
    }, [open, target, messages])

    const captures = useAtomValue(sessionCapturesAtomFamily(sessionId))
    const turnCaptures = useMemo(() => {
        if (!open || !target) return []
        const idx = messages.findIndex((m) => m.id === target.assistantMessageId)
        // The trigger is the last user message at or before this assistant turn.
        let triggerId: string | null = null
        for (let i = idx; i >= 0; i--) {
            if (messages[i]?.role === "user") {
                triggerId = messages[i].id
                break
            }
        }
        return capturesForTrigger(captures, triggerId)
    }, [open, target, messages, captures])

    // Stays mounted and animates its width (0↔PANEL_WIDTH) in lockstep with the build/chat mode
    // switch, so it slides in/out instead of snapping. Clipped + `inert` while collapsed.
    return (
        <div
            className="h-full shrink-0 overflow-hidden motion-safe:transition-[width] motion-safe:duration-[240ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{width: open ? PANEL_WIDTH : 0}}
            inert={!open}
        >
            <div
                className="ag-inspector-panel flex h-full min-h-0 flex-col"
                style={{width: PANEL_WIDTH}}
            >
                <div className="flex shrink-0 items-center justify-between border-0 border-b border-solid border-[var(--ag-surface-divider)] px-3 py-2">
                    <span className="text-xs font-medium text-[var(--ag-colorText)]">
                        Turn inspector
                    </span>
                    <Button
                        onClick={() => setTarget(null)}
                        aria-label="Close turn inspector"
                        variant="ghost"
                        size="icon-sm"
                    >
                        {<X size={14} />}
                    </Button>
                </div>
                {/* Horizontal tab bar — tabs on top so the content gets the panel's full width (a
                    vertical rail ate ~130px of a ~480px panel, squeezing the tool I/O JSON too narrow). */}
                <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-[var(--ag-surface-divider)] px-2 py-1.5">
                    {TABS.map((t) => {
                        const active = t.value === tab
                        return (
                            <Button
                                key={t.value}
                                onClick={() => setTab(t.value)}
                                className={`!h-7 !rounded-md !px-2.5 !text-xs transition-colors ${
                                    active
                                        ? "!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]"
                                        : "!text-[var(--ag-colorTextSecondary)] hover:!bg-[var(--ag-colorFillTertiary)] hover:!text-[var(--ag-colorText)]"
                                }`}
                                variant="ghost"
                            >
                                {t.label}
                            </Button>
                        )
                    })}
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
                    {tab === "timeline" ? <TimelineTab round={round} /> : null}
                    {tab === "context" ? <ContextTab captures={turnCaptures} /> : null}
                    {tab === "raw" ? <RawTab captures={turnCaptures} /> : null}
                </div>
            </div>
        </div>
    )
}

export default TurnInspector
