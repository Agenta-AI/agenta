import {useRef} from "react"

import {X} from "@phosphor-icons/react"
import type {UIMessage} from "ai"
import {Button, Segmented} from "antd"
import {useAtom} from "jotai"

import {rightPanelAtom} from "../../state/rightPanel"

import SessionView from "./SessionView"
import TurnView from "./TurnView"

/**
 * The single right-side panel next to the chat. One slot, two contexts: a `turn` view (inspect one
 * assistant turn — build mode) and a `session` view (session-scoped content — mounts/state/…). The
 * segmented control switches between them; Turn is only selectable while a turn is being inspected
 * (you enter it by clicking "Inspect turn" on a message). Rendered inside the resizable
 * `RightPanelSplit`; returns `null` when this session isn't the active target.
 */
const RightPanel = ({sessionId, messages}: {sessionId: string; messages: UIMessage[]}) => {
    const [target, setTarget] = useAtom(rightPanelAtom)
    const active = target?.sessionId === sessionId ? target : null
    // Retain the last target so the close slide shows the panel's content while it collapses —
    // the parent split unmounts this component once the animation finishes.
    const lastTargetRef = useRef(active)
    if (active) lastTargetRef.current = active
    const shown = active ?? lastTargetRef.current
    if (!shown) return null

    const isTurn = shown.mode === "turn"

    return (
        <div className="ag-inspector-panel flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-[var(--ag-surface-divider)] px-2 py-2">
                <Segmented
                    size="small"
                    value={shown.mode}
                    onChange={(value) => {
                        if (value === "session") setTarget({mode: "session", sessionId})
                    }}
                    options={[
                        {label: "Turn", value: "turn", disabled: !isTurn},
                        {label: "Session", value: "session"},
                    ]}
                />
                <Button
                    type="text"
                    size="small"
                    icon={<X size={14} />}
                    onClick={() => setTarget(null)}
                    aria-label="Close panel"
                />
            </div>
            <div className="min-h-0 min-w-0 flex-1">
                {isTurn ? (
                    <TurnView
                        sessionId={sessionId}
                        messages={messages}
                        assistantMessageId={shown.assistantMessageId}
                    />
                ) : (
                    <SessionView sessionId={sessionId} initialTab={shown.tab} />
                )}
            </div>
        </div>
    )
}

export default RightPanel
