import {useRef} from "react"

import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {Button} from "antd"
import {useSetAtom} from "jotai"
import {Lock} from "lucide-react"

import type {AgentModelKeyStatus} from "../hooks/useAgentModelKeyStatus"
import {chatPanelMaximizedAtom} from "../state/panelLayout"

import RevealCollapse from "./RevealCollapse"

/**
 * Connect-a-model prompt shown above the composer while the project vault is empty (see `gateActive`
 * on `useAgentModelKeyStatus` — project-wide, not per-provider). The composer is disabled alongside it
 * (the parent gates on the same status). "Set up credentials" flips the playground to Build and opens
 * the Model & harness drawer, whose bottom credentials field lets the user add the key without leaving
 * — saving it clears this banner reactively (any key added → gate never fires again).
 *
 * Always mounted so it can animate IN (gate activates) and OUT (key added / not applicable) via
 * `RevealCollapse` instead of popping. Shown only when `gateActive` and not `suppressed` (the
 * pre-commit onboarding defers the check).
 */
const ConnectModelBanner = ({
    provider,
    providerEntry,
    gateActive,
    suppressed = false,
}: AgentModelKeyStatus & {suppressed?: boolean}) => {
    const setChatMaximized = useSetAtom(chatPanelMaximizedAtom)
    const openConfigSection = useSetAtom(openAgentConfigSectionAtom)

    const open = !suppressed && gateActive
    // Latch the label so the banner keeps its text while it collapses closed (the leave transition
    // needs its content to persist through the height animation).
    const labelRef = useRef("a model")
    if (providerEntry) labelRef.current = providerEntry.title ?? provider ?? "a model"

    const openCredentials = () => {
        setChatMaximized(false)
        openConfigSection("model-harness")
    }

    return (
        <RevealCollapse open={open}>
            <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--ag-colorWarningText)]">
                    <Lock size={14} className="shrink-0" />
                    <span className="truncate">
                        Connect {labelRef.current} to run this agent with your own key.
                    </span>
                </span>
                <Button type="primary" onClick={openCredentials} className="shrink-0">
                    Set up credentials
                </Button>
            </div>
        </RevealCollapse>
    )
}

export default ConnectModelBanner
