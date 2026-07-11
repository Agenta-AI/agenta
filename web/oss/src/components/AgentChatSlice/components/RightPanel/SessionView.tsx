import {useState} from "react"

import {Button} from "antd"

import InteractionsTab from "@/oss/components/SessionInspector/tabs/InteractionsTab"
import MountsTab from "@/oss/components/SessionInspector/tabs/MountsTab"
import StatesTab from "@/oss/components/SessionInspector/tabs/StatesTab"

import type {SessionPanelTab} from "../../state/rightPanel"

const TABS: {value: SessionPanelTab; label: string}[] = [
    {value: "mounts", label: "Mounts"},
    {value: "state", label: "State"},
    {value: "interactions", label: "Interactions"},
]

/**
 * The "session" view of the right panel: session-scoped content that coexists with the chat.
 * Mounts (the durable workspace) is the primary tab; State + Interactions reuse the same durable
 * endpoints. Records is intentionally omitted (it's the transcript the chat already renders).
 */
const SessionView = ({
    sessionId,
    initialTab,
}: {
    sessionId: string
    initialTab?: SessionPanelTab
}) => {
    const [tab, setTab] = useState<SessionPanelTab>(initialTab ?? "mounts")

    return (
        <div className="flex h-full min-h-0 flex-col">
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
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
                {tab === "mounts" ? <MountsTab sessionId={sessionId} /> : null}
                {tab === "state" ? <StatesTab sessionId={sessionId} /> : null}
                {tab === "interactions" ? <InteractionsTab sessionId={sessionId} /> : null}
            </div>
        </div>
    )
}

export default SessionView
