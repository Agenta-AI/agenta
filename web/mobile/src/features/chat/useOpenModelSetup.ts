import {useCallback} from "react"

import {revealConfigPaneAtom} from "@agenta/chat/state"
import {openAgentConfigSectionAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"

/** Opens the config pane's Model drawer, the existing model picker, from the needs-setup banner. */
export const useOpenModelSetup = () => {
    const revealConfigPane = useSetAtom(revealConfigPaneAtom)
    const openSection = useSetAtom(openAgentConfigSectionAtom)
    return useCallback(() => {
        revealConfigPane()
        openSection("model-harness")
    }, [openSection, revealConfigPane])
}
