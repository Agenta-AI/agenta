import {useMemo, useState} from "react"

import {capturesForTrigger} from "@agenta/playground"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import type {UIMessage} from "ai"
import {Segmented} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {sessionCapturesAtomFamily} from "../../state/turnCaptures"
import {turnInspectorAtom} from "../../state/turnInspector"

import ContextTab from "./ContextTab"
import RawTab from "./RawTab"
import TimelineTab from "./TimelineTab"

type Tab = "timeline" | "context" | "raw"

/**
 * Dedicated Build-mode turn inspector. Mounted per session inside `AgentConversation` so it reads
 * the LIVE `useChat` `messages` (the same list the transcript renders) — the selected turn is found
 * by id in the live list, and it updates as the turn streams. It opens ONLY for the session that is
 * the current inspector target, so the N mounted tabs don't each pop a drawer. Own state
 * (`turnInspectorAtom`), NOT the trace drawer.
 */
const TurnInspector = ({sessionId, messages}: {sessionId: string; messages: UIMessage[]}) => {
    const [target, setTarget] = useAtom(turnInspectorAtom)
    const [tab, setTab] = useState<Tab>("timeline")

    const open = target?.sessionId === sessionId

    const message: UIMessage | null = useMemo(() => {
        if (!open || !target) return null
        return messages.find((m) => m.id === target.assistantMessageId) ?? null
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
        >
            <div className="flex h-full min-h-0 flex-col">
                <div className="px-4 pt-2">
                    <Segmented<Tab>
                        value={tab}
                        onChange={setTab}
                        options={[
                            {label: "Timeline", value: "timeline"},
                            {label: "Context", value: "context"},
                            {label: "Raw", value: "raw"},
                        ]}
                    />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {tab === "timeline" ? <TimelineTab message={message} /> : null}
                    {tab === "context" ? <ContextTab captures={turnCaptures} /> : null}
                    {tab === "raw" ? <RawTab captures={turnCaptures} /> : null}
                </div>
            </div>
        </EnhancedDrawer>
    )
}

export default TurnInspector
