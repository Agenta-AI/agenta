import {useCallback, useMemo} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {useSetAtom} from "jotai"

import {selectedRevisionAtomFamily} from "../chat/selectedRevision"

import {AgentConfigHost} from "./AgentConfigHost"
import {useAgentPanel} from "./agentPanelContext"
import {ConfigurationRoot} from "./ConfigurationRoot"
import {shownConfigTab} from "./shownConfigTab"

export interface ConfigurationContentProps {
    agentId: string
    revisionId: string
    sessionId: string
    filesScope: string
    workspaceId: string
    projectId: string
}

/** The Configuration content of the session's right panel: the shared agent pane over four tabs. */
export const ConfigurationContent = (props: ConfigurationContentProps) => {
    const t = useT(agentLayoutPanelCatalog, agentLayoutHeaderCatalog)
    const panel = useAgentPanel()
    // A commit made here pins the new revision to this session.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(props.sessionId))
    const {wide, setWide, close} = panel
    const widen = useMemo(() => ({wide, setWide}), [wide, setWide])
    const onClose = useCallback(() => void close(), [close])
    return (
        <AgentConfigHost
            agentId={props.agentId}
            revisionId={props.revisionId}
            projectId={props.projectId}
            // Read again each time the Agent tab opens, so a change in the Channels tab shows.
            readChannels={shownConfigTab(panel) === "agent"}
            // On a phone the back arrow names the Configuration screen; on the desktop, the tab.
            rootTitle={
                panel.phone
                    ? t("agentLayout.header.configuration")
                    : t(`agentLayout.panel.${panel.configTab}`)
            }
            phone={panel.phone}
            // The content stays mounted, hidden, after the panel closes.
            shown={panel.content === "configuration"}
            widen={widen}
            onClose={onClose}
            onWorkflowRevisionCommitted={pinRevision}
        >
            {(section) => (
                <ConfigurationRoot
                    {...props}
                    phoneSection={section.shown}
                    onCloseSection={section.close}
                />
            )}
        </AgentConfigHost>
    )
}
