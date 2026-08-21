/**
 * Which half of the session workspace is on screen.
 *
 * The split holds the pane (configuration, or the sessions rail) beside the conversation. With two
 * panes both are visible and this only picks what sits on the left. On a phone there is no room
 * for two, so the pane REPLACES the conversation: anything that turns the pane on takes the chat,
 * and its composer, off the screen. That is why the rule lives here with tests rather than inline.
 */
export interface SessionPaneInputs {
    /** The Build/Chat switch. Shared with the desktop playground through localStorage. */
    chatMaximized: boolean
    /** The config pane's collapse state, which `configPanelCollapsedAtom` defaults per device. */
    configCollapsed: boolean
    /** True at `md` and wider. False on a phone, where the pane replaces the conversation. */
    twoPane: boolean
    /** False when the session has no revision to configure yet, such as a session with no turns. */
    hasEntity: boolean
}

export interface SessionPanes {
    /** Put the configuration in the pane slot. Otherwise the slot holds the sessions rail. */
    showConfig: boolean
    /** Give the pane slot the screen. On a phone this hides the conversation. */
    showPane: boolean
}

export const resolveSessionPanes = ({
    chatMaximized,
    configCollapsed,
    twoPane,
    hasEntity,
}: SessionPaneInputs): SessionPanes => {
    const showConfig = !chatMaximized && !configCollapsed && hasEntity
    // The sessions rail stands in for the config panel ONLY in maximized mode, as on the desktop.
    // Collapsing config collapses the PANE and gives the width to the conversation; swapping the
    // rail in instead means the collapse never actually frees any space.
    //
    // That swap needs two panes to mean anything. On a phone it put the sessions list where the
    // chat belongs, with no way out: `/m` reads the maximized flag and never writes it, and the
    // desktop playground writes it to the same origin. A phone in maximized mode shows the
    // conversation, and the tab rail above it still reaches every session.
    return {showConfig, showPane: showConfig || (twoPane && chatMaximized)}
}
