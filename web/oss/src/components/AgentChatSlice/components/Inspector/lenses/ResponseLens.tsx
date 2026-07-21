/**
 * ResponseLens — the session's response-channel preference (stream vs batch). Session-scoped like
 * Runtime: it sets how THIS conversation's `/invoke` calls negotiate transport (the `Accept` header
 * `buildAgentRequest` sends), NOT revision config. Persisted per session via
 * `agentChannelModeAtomFamily`. A focused turn doesn't change it — it's a session preference.
 */
import type {ReactNode} from "react"

import {agentChannelModeAtomFamily, type AgentChannelMode} from "@agenta/playground"
import {Broadcast, Package} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtom} from "jotai"

const OPTIONS: {
    value: AgentChannelMode
    label: string
    icon: ReactNode
    blurb: string
}[] = [
    {
        value: "stream",
        label: "Stream",
        icon: <Broadcast size={18} />,
        blurb: "Render the reply token-by-token as the agent produces it. Best for watching the agent think and for long responses.",
    },
    {
        value: "batch",
        label: "Batch",
        icon: <Package size={18} />,
        blurb: "Wait for the full reply, then land it in one frame. Skips the live stream — useful when comparing final outputs or when the handler can only batch.",
    },
]

export function ResponseLens({sessionId}: {sessionId: string}) {
    const [mode, setMode] = useAtom(agentChannelModeAtomFamily(sessionId))

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
            <Typography.Text type="secondary" className="text-xs">
                How this session receives replies from the agent. A transport preference for this
                conversation only — it is not saved on the revision.
            </Typography.Text>
            <div role="radiogroup" aria-label="Response channel" className="flex flex-col gap-2">
                {OPTIONS.map((opt) => {
                    const selected = mode === opt.value
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setMode(opt.value)}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border border-solid px-3 py-2.5 text-left transition-colors ${
                                selected
                                    ? "border-[var(--ag-colorPrimary)] bg-[var(--ag-colorPrimaryBg)]"
                                    : "border-colorBorderSecondary bg-transparent hover:bg-colorFillTertiary"
                            }`}
                        >
                            <span
                                className={`mt-0.5 shrink-0 ${
                                    selected
                                        ? "text-[var(--ag-colorPrimary)]"
                                        : "text-colorTextSecondary"
                                }`}
                            >
                                {opt.icon}
                            </span>
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span
                                    className={`text-xs font-medium ${
                                        selected
                                            ? "text-[var(--ag-colorPrimary)]"
                                            : "text-colorText"
                                    }`}
                                >
                                    {opt.label}
                                </span>
                                <span className="text-[11px] leading-snug text-colorTextTertiary">
                                    {opt.blurb}
                                </span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
