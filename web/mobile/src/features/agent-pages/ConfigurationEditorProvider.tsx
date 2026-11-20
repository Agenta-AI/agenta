import {useMemo, useState, type ReactNode} from "react"

import {AgentEditorContext, type AgentEditor} from "@agenta/entity-ui/drill-in"
import {OpenViewItemContext, type OpenViewItem} from "@agenta/ui/view-stack"
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
 * page context the builder reads when a message is sent (the open tab, and the item an open view
 * shows).
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
    // The item an open view shows, reported by the view's stack (a drawer here).
    const [item, setItem] = useState<OpenViewItem | null>(null)
    usePublishPageContext({kind: "configuration", tab, ...(item ? {item} : {})})
    const [hasChannel, setHasChannel] = useState<boolean | undefined>(undefined)
    const editor = useMemo<AgentEditor | null>(
        () => (revisionId ? {revisionId, readOnly, hasChannel} : null),
        [hasChannel, readOnly, revisionId],
    )
    return (
        <OpenViewItemContext.Provider value={setItem}>
            <AgentEditorContext.Provider value={editor}>
                <AgentChannelPresence agentId={agentId} onChange={setHasChannel} />
                {children}
            </AgentEditorContext.Provider>
        </OpenViewItemContext.Provider>
    )
}
