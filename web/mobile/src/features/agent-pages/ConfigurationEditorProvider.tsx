import {useMemo, useState, type ReactNode} from "react"

import {AgentEditorContext, type AgentEditor} from "@agenta/entity-ui/drill-in"
import dynamic from "next/dynamic"

import {usePublishPageContext} from "../builder/pageContext"

import type {ConfigurationTab} from "./configurationTabs"

// Loaded on its own, as in the panel: it keeps the channel code out of the page.
const AgentChannelPresence = dynamic(() => import("../agent-layout/AgentChannelPresence"), {
    ssr: false,
})

/**
 * What the views on the Configuration page share with the rest of the app: the editor (the held
 * revision, the edit right and whether the agent answers in a channel, as in the panel) and the
 * page context the builder reads when a message is sent (the open tab).
 */
export const ConfigurationEditorProvider = ({
    agentId,
    revisionId,
    readOnly,
    tab,
    children,
}: {
    agentId: string
    revisionId: string | null
    readOnly: boolean
    tab: ConfigurationTab
    children: ReactNode
}) => {
    // The page names its tab. A view opens in a drawer here, so the open item is not named yet.
    usePublishPageContext({kind: "configuration", tab})
    const [hasChannel, setHasChannel] = useState<boolean | undefined>(undefined)
    const editor = useMemo<AgentEditor | null>(
        () => (revisionId ? {revisionId, readOnly, hasChannel} : null),
        [hasChannel, readOnly, revisionId],
    )
    return (
        <AgentEditorContext.Provider value={editor}>
            <AgentChannelPresence agentId={agentId} onChange={setHasChannel} />
            {children}
        </AgentEditorContext.Provider>
    )
}
