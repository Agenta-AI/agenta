import {useCallback, useLayoutEffect, useRef, useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useMediaQuery} from "@agenta/ui/hooks"

import {useBindWorkspaceMembers} from "../useBindWorkspaceMembers"

import {SessionDrawerBody} from "./SessionDrawerBody"
import {SessionDrawerHeader} from "./SessionDrawerHeader"
import {useSessionDrawerUrl} from "./useSessionDrawerUrl"

const NORMAL_WIDTH = 1250
const EXPANDED_WIDTH = 1920

interface ObservabilitySessionDrawerProps {
    /** `null` closes the drawer. The panel keeps the last session while it slides out. */
    sessionId: string | null
    onSelectSession: (sessionId: string) => void
}

/**
 * The right-hand panel of one observability session: its traces in order, with a tree beside
 * them. The address bar decides whether it is open, so this holds no open state of its own.
 * The screen loads this file with `next/dynamic` on the first open, so the page every user
 * opens does not carry it.
 */
const ObservabilitySessionDrawer = ({
    sessionId,
    onSelectSession,
}: ObservabilitySessionDrawerProps) => {
    const {spanId, close} = useSessionDrawerUrl()
    useBindWorkspaceMembers()
    // Below 720px the panel is as wide as the screen, so the tree has no room and widening does nothing.
    const wide = useMediaQuery("(min-width: 720px)")
    // The tree takes 320px and the annotations 300px more, so they sit beside the messages only
    // when the drawer is wide enough to leave the messages room.
    const annotationsBeside = useMediaQuery("(min-width: 1100px)")
    const [expanded, setExpanded] = useState(false)
    const [lastSessionId, setLastSessionId] = useState(sessionId)
    if (sessionId !== null && sessionId !== lastSessionId) setLastSessionId(sessionId)
    const shownSessionId = sessionId ?? lastSessionId
    const open = sessionId !== null

    // Radix gives focus back only to a registered trigger, and a row opens this drawer through the
    // URL. So the drawer keeps the element that had focus when it opened (the row, after Enter)
    // and focuses it again once the panel has slid out. A layout effect runs before the drawer
    // moves focus inside itself.
    const returnFocusTo = useRef<Element | null>(null)
    useLayoutEffect(() => {
        if (open) returnFocusTo.current = document.activeElement
    }, [open])
    const afterOpenChange = useCallback((isOpen: boolean) => {
        const target = returnFocusTo.current
        if (isOpen || !(target instanceof HTMLElement) || !target.isConnected) return
        returnFocusTo.current = null
        target.focus()
    }, [])

    return (
        <EnhancedDrawer
            closable={false}
            title={null}
            open={open}
            onClose={close}
            afterOpenChange={afterOpenChange}
            width={expanded ? EXPANDED_WIDTH : NORMAL_WIDTH}
            styles={{body: {padding: 0}}}
            destroyOnHidden
        >
            {shownSessionId ? (
                <div className="flex h-full min-h-0 flex-col" data-testid="session-drawer">
                    <SessionDrawerHeader
                        sessionId={shownSessionId}
                        onSelectSession={onSelectSession}
                        onClose={close}
                        showWidthToggle={wide}
                        expanded={expanded}
                        onToggleWidth={() => setExpanded(!expanded)}
                    />
                    <SessionDrawerBody
                        key={shownSessionId}
                        sessionId={shownSessionId}
                        linkedSpanId={spanId}
                        narrow={!wide}
                        annotationsBeside={annotationsBeside}
                    />
                </div>
            ) : null}
        </EnhancedDrawer>
    )
}

export default ObservabilitySessionDrawer
