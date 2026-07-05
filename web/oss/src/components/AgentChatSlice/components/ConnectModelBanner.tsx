import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {Button} from "antd"
import {useSetAtom} from "jotai"
import {Lock} from "lucide-react"

import type {AgentModelKeyStatus} from "../hooks/useAgentModelKeyStatus"
import {chatPanelMaximizedAtom} from "../state/panelLayout"

/**
 * Connect-a-model prompt shown above the composer when the agent's model provider has no vault key.
 * The composer is disabled alongside it (the parent gates on the same status). "Set up credentials"
 * flips the playground to Build and opens the Model & harness drawer, whose bottom credentials field
 * lets the user add the key without leaving — saving it clears this banner reactively (vault → hasKey).
 * Renders nothing once a key exists or when the provider can't be resolved (never a false gate).
 */
const ConnectModelBanner = ({hasKey, provider, providerEntry}: AgentModelKeyStatus) => {
    const setChatMaximized = useSetAtom(chatPanelMaximizedAtom)
    const openConfigSection = useSetAtom(openAgentConfigSectionAtom)

    if (hasKey || !providerEntry) return null

    const label = providerEntry.title ?? provider ?? "a model"

    const openCredentials = () => {
        setChatMaximized(false)
        openConfigSection("model-harness")
    }

    return (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--ag-colorWarningText)]">
                <Lock size={14} className="shrink-0" />
                <span className="truncate">
                    Connect {label} to run this agent with your own key.
                </span>
            </span>
            <Button type="primary" onClick={openCredentials} className="shrink-0">
                Set up credentials
            </Button>
        </div>
    )
}

export default ConnectModelBanner
