import {useEffect, useMemo, useState, type MutableRefObject, type ReactNode} from "react"

import {
    AgentEditorContext,
    PhoneSectionsContext,
    usePhoneSectionScreen,
    type AgentEditor,
    type PhoneSection,
} from "@agenta/entity-ui/drill-in"
import {useSystemBack, ViewStackHost} from "@agenta/ui/view-stack"
import dynamic from "next/dynamic"

import {PageViewStackGuard, type PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"
import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {useProjectPermissionState} from "../context/useProjectPermission"

import {PanelChromeContext, PanelViewChrome, type PanelChromeControls} from "./PanelViewChrome"
import {StackGuards} from "./StackGuards"

// The channel read loads on its own: its code is not part of the Configuration chunk.
const AgentChannelPresence = dynamic(() => import("./AgentChannelPresence"), {ssr: false})

/** On a phone, the section shown as its own screen and the way back to the rows. */
export interface PhoneSectionScreen {
    shown: PhoneSection | null
    close: () => void
}

/**
 * The agent's configuration pane, shared by the session's right panel, the builder page and the
 * agent's Configuration page: one view stack with the panel chrome over the tabs (`children`), the
 * agent editor (revision, edit right, channel presence) and the DrillIn bridge its views use.
 */
export const AgentConfigHost = ({
    agentId,
    revisionId,
    projectId,
    readChannels,
    rootTitle,
    phone = false,
    sectionScreen: pageSectionScreen,
    shown = true,
    widen,
    onClose,
    page = false,
    onWorkflowRevisionCommitted,
    guardRef,
    children,
}: {
    agentId: string
    /** Null while the revision loads: the views get no editor. */
    revisionId: string | null
    projectId: string
    /** Read whether the agent answers in a channel (the Agent tab warns about personal accounts). */
    readChannels: boolean
    /** The first crumb; on a phone a shown section's title takes its place. */
    rootTitle: string
    /** A phone screen: phone chrome, and the Agent tab's sections open as their own screens. */
    phone?: boolean
    /** The phone section screen, when the container draws its header itself (a page). */
    sectionScreen?: ReturnType<typeof usePhoneSectionScreen>
    /** The pane is on screen: only then is a section screen a level of the browser back. */
    shown?: boolean
    widen?: PanelChromeControls["widen"]
    onClose?: () => void
    /** The agent's Configuration page, not a pane: its view header drops the pane's rule. */
    page?: boolean
    /** A commit made in the pane; the container pins the new revision. */
    onWorkflowRevisionCommitted: (revisionId: string) => void
    /** The page's hold on the stack, so it can close the views before it changes the pane. */
    guardRef?: MutableRefObject<PageViewStackGuardApi | null>
    children: (section: PhoneSectionScreen) => ReactNode
}) => {
    // Editing stays open while the check is in flight, so editors do not see it lock and unlock.
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const readOnly = !editAccess.pending && !editAccess.allowed
    // A channel run has no person: integrations that use each person's own account warn.
    const [hasChannel, setHasChannel] = useState<boolean | undefined>(undefined)
    const editor = useMemo<AgentEditor | null>(
        () => (revisionId ? {revisionId, readOnly, hasChannel} : null),
        [revisionId, readOnly, hasChannel],
    )
    // On a phone the Agent tab is a list of rows, and a row opens its section as a screen.
    const ownSectionScreen = usePhoneSectionScreen(phone && !pageSectionScreen)
    const sectionScreen = pageSectionScreen ?? ownSectionScreen
    useSystemBack(shown && sectionScreen.shown ? 1 : 0, "section", sectionScreen.close)
    // A hidden pane drops its section screen, so it opens again at its root.
    const closeSection = sectionScreen.close
    useEffect(() => {
        if (!shown) closeSection()
    }, [shown, closeSection])
    const chrome = useMemo<PanelChromeControls>(
        () => ({phone, widen, onClose, page}),
        [phone, widen, onClose, page],
    )
    return (
        // The bridge holds the stack, so an open view gets the same host parts as the tab's root.
        <DrillInBridgeProvider
            projectId={projectId}
            onWorkflowRevisionCommitted={onWorkflowRevisionCommitted}
        >
            {readChannels ? (
                <AgentChannelPresence agentId={agentId} onChange={setHasChannel} />
            ) : null}
            <AgentEditorContext.Provider value={editor}>
                <PhoneSectionsContext.Provider value={sectionScreen.api}>
                    <PanelChromeContext.Provider value={chrome}>
                        <ViewStackHost
                            chrome={PanelViewChrome}
                            rootTitle={(phone && sectionScreen.shown?.title) || rootTitle}
                            phone={phone}
                            // On a section screen Escape is its back arrow, not a close.
                            onEscapeAtRoot={sectionScreen.shown ? closeSection : undefined}
                        >
                            <StackGuards />
                            {guardRef ? <PageViewStackGuard guardRef={guardRef} /> : null}
                            {children({shown: sectionScreen.shown, close: sectionScreen.close})}
                        </ViewStackHost>
                    </PanelChromeContext.Provider>
                </PhoneSectionsContext.Provider>
            </AgentEditorContext.Provider>
        </DrillInBridgeProvider>
    )
}
