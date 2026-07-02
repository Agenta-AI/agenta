import {useMemo, useState} from "react"

import {capturesForTrigger} from "@agenta/playground"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import type {UIMessage} from "ai"
import {Segmented} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {sessionMessagesAtom} from "../../state/sessions"
import {sessionCapturesAtomFamily} from "../../state/turnCaptures"
import {turnInspectorAtom} from "../../state/turnInspector"

import ContextTab from "./ContextTab"
import TimelineTab from "./TimelineTab"

type Tab = "timeline" | "context" | "raw"

/** Dedicated Build-mode turn inspector. Own state (`turnInspectorAtom`), NOT the trace drawer. */
const TurnInspector = () => {
    const [target, setTarget] = useAtom(turnInspectorAtom)
    const allMessages = useAtomValue(sessionMessagesAtom)
    const [tab, setTab] = useState<Tab>("timeline")

    const message: UIMessage | null = useMemo(() => {
        if (!target) return null
        const list = allMessages[target.sessionId] ?? []
        return list.find((m) => m.id === target.assistantMessageId) ?? null
    }, [target, allMessages])

    const captures = useAtomValue(sessionCapturesAtomFamily(target?.sessionId ?? ""))
    const turnCaptures = useMemo(() => {
        if (!target) return []
        const list = allMessages[target.sessionId] ?? []
        const idx = list.findIndex((m) => m.id === target.assistantMessageId)
        // The trigger is the last user message at or before this assistant turn.
        let triggerId: string | null = null
        for (let i = idx; i >= 0; i--) {
            if (list[i]?.role === "user") {
                triggerId = list[i].id
                break
            }
        }
        return capturesForTrigger(captures, triggerId)
    }, [target, allMessages, captures])

    return (
        <EnhancedDrawer
            open={!!target}
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
                    {tab === "raw" ? (
                        <div className="p-4 text-xs text-colorTextTertiary">
                            Raw — added in Phase 3.
                        </div>
                    ) : null}
                </div>
            </div>
        </EnhancedDrawer>
    )
}

export default TurnInspector
