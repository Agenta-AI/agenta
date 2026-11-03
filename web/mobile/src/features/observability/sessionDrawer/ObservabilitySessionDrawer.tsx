import {useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useMediaQuery} from "@agenta/ui/hooks"

import {SessionDrawerBody} from "./SessionDrawerBody"
import {SessionDrawerHeader} from "./SessionDrawerHeader"

const NORMAL_WIDTH = 1250
const EXPANDED_WIDTH = 1920

interface ObservabilitySessionDrawerProps {
    /** `null` closes the drawer. The panel keeps the last session while it slides out. */
    sessionId: string | null
    spanId: string | null
    onSelectSession: (sessionId: string) => void
    onClose: () => void
}

/**
 * The right-hand panel of one observability session: its traces in order, with a tree beside
 * them. The address bar decides whether it is open, so this holds no open state of its own.
 * The screen loads this file with `next/dynamic` on the first open, so the page every user
 * opens does not carry it.
 */
const ObservabilitySessionDrawer = ({
    sessionId,
    spanId,
    onSelectSession,
    onClose,
}: ObservabilitySessionDrawerProps) => {
    // Below 720px the panel is as wide as the screen, so the tree has no room and widening does nothing.
    const wide = useMediaQuery("(min-width: 720px)")
    const [expanded, setExpanded] = useState(false)
    const [lastSessionId, setLastSessionId] = useState(sessionId)
    if (sessionId !== null && sessionId !== lastSessionId) setLastSessionId(sessionId)
    const shownSessionId = sessionId ?? lastSessionId

    return (
        <EnhancedDrawer
            closable={false}
            title={null}
            open={sessionId !== null}
            onClose={onClose}
            width={expanded ? EXPANDED_WIDTH : NORMAL_WIDTH}
            styles={{body: {padding: 0}}}
            destroyOnHidden
        >
            {shownSessionId ? (
                <div className="flex h-full min-h-0 flex-col" data-testid="session-drawer">
                    <SessionDrawerHeader
                        sessionId={shownSessionId}
                        onSelectSession={onSelectSession}
                        onClose={onClose}
                        showWidthToggle={wide}
                        expanded={expanded}
                        onToggleWidth={() => setExpanded(!expanded)}
                    />
                    <SessionDrawerBody
                        key={shownSessionId}
                        sessionId={shownSessionId}
                        linkedSpanId={spanId}
                        narrow={!wide}
                    />
                </div>
            ) : null}
        </EnhancedDrawer>
    )
}

export default ObservabilitySessionDrawer
