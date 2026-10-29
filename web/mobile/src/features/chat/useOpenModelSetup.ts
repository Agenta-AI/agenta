import {useCallback} from "react"

import {configPanelCollapsedAtom} from "@agenta/chat/state"
import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"

/** Opens the config pane's Model drawer, the existing model picker, from the needs-setup banner. */
export const useOpenModelSetup = () => {
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)
    const openSection = useSetAtom(openAgentConfigSectionAtom)
    return useCallback(() => {
        setConfigCollapsed(false)
        openSection("model-harness")
    }, [openSection, setConfigCollapsed])
}
