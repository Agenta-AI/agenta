import {useMemo, useState} from "react"

import {capturesForTrigger} from "@agenta/playground"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import type {UIMessage} from "ai"
import {Button} from "antd"
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

/**
 * Dedicated Build-mode turn inspector. Mounted per session inside `AgentConversation` so it reads
 * the LIVE `useChat` `messages` (the same list the transcript renders) — accurate turn + live
 * streaming — and opens ONLY for the session that is the current inspector target. Laid out with the
 * drawer siderail pattern (vertical Timeline/Context/Raw rail + bordered content). Own state
 * (`turnInspectorAtom`), NOT the trace drawer.
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

    return (
        <EnhancedDrawer
            open={open}
            onClose={() => setTarget(null)}
            width={560}
            title="Turn inspector"
            destroyOnHidden
            styles={{body: {padding: 0}}}
        >
            <div className="flex h-full min-h-0 gap-3 p-3">
                <div className="flex w-[104px] shrink-0 flex-col gap-0.5">
                    {TABS.map((t) => {
                        const active = t.value === tab
                        return (
                            <Button
                                key={t.value}
                                type="text"
                                block
                                onClick={() => setTab(t.value)}
                                className={`!h-8 !justify-start !rounded-md !px-2.5 !text-xs transition-colors ${
                                    active
                                        ? "!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]"
                                        : "!text-[var(--ag-colorTextSecondary)] hover:!bg-[var(--ag-colorFillTertiary)] hover:!text-[var(--ag-colorText)]"
                                }`}
                            >
                                {t.label}
                            </Button>
                        )
                    })}
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col border-0 border-l border-solid border-[var(--ag-colorBorder)] pl-3">
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                        {tab === "timeline" ? <TimelineTab round={round} /> : null}
                        {tab === "context" ? <ContextTab captures={turnCaptures} /> : null}
                        {tab === "raw" ? <RawTab captures={turnCaptures} /> : null}
                    </div>
                </div>
            </div>
        </EnhancedDrawer>
    )
}

export default TurnInspector
