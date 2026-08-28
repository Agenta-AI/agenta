import {createElement, useCallback, useMemo, type ReactNode} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {AgentGlyph} from "@agenta/entity-ui/agent"
import {
    AGENTS_SIDEBAR_KEY,
    buildHelpDocsNavItem,
    defineSidebarEntity,
    resolveChildren,
    SESSIONS_SIDEBAR_KEY,
    sidebarAgentRanksAtomFamily,
    sidebarSessionToggledGroupsAtomFamily,
    sidebarSessionGroupKey,
    sidebarSessionGroupsAtomFamily,
    sidebarSessionScopeLimit,
    sidebarSessionsListAtomFamily,
    withEntityGroups,
    withRefsByRecency,
    type SessionSidebarRef,
    type SidebarConfig,
    type SidebarEntityRef,
} from "@agenta/navigation"
import {SessionFilterMenu} from "@agenta/navigation-ui"
import {SessionRowActions, useSessionActions, useSessionRowChrome} from "@agenta/sessions-ui"
import {atom, useAtomValue} from "jotai"
import {unwrap} from "jotai/utils"
import {
    Activity,
    Bot,
    CalendarClock,
    Circle,
    HelpCircle,
    LoaderCircle,
    Zap,
    Github,
    House,
    MessagesSquare,
    ScrollText,
    Settings,
    Slack,
} from "lucide-react"

/** The drawer's scope id — its open-groups persistence bucket. */
export const MOBILE_NAV_SCOPE_ID = "mobile-main"

/**
 * Mobile's registration over the SHARED machinery: same gated sessions source, same
 * pinned-first ordering, mobile's own child routes. Desktop's registry entry differs only
 * in its paths and its pending-open handoff — the model is the reuse, the content is ours.
 */
const mobileSessionsEntity = defineSidebarEntity<SessionSidebarRef>(
    MOBILE_NAV_SCOPE_ID,
    SESSIONS_SIDEBAR_KEY,
    {
        kind: "app",
        icon: createElement(MessagesSquare, {size: 14}),
        // Its OWN scope: the source reads that scope's filters, so the desktop rail's filters
        // cannot narrow this drawer. Mobile has no filter UI, so this scope keeps the defaults.
        listAtom: sidebarSessionsListAtomFamily(MOBILE_NAV_SCOPE_ID),
        getLabel: (session) => session.name || "Untitled session",
        childPath: (session) => `/sessions/${session.sessionId}`,
        emptyLabel: "No sessions yet",
        // No "Show all" row: the group's own "Sessions" row already links to the full list, and
        // the headings make a trailing overflow link read as one more session.
        // No pin glyph: pinned rows sit under their own heading, which says it once.
        // Amber for a session blocked on you. `--ag-run-status-warning` rather than
        // `colorWarning`: the semantic token's light step is a muddy #8a6400 that reads as
        // disabled at 8px, and this one is the palette's bright amber in BOTH themes.
        getIcon: (session) => {
            // State wins the glyph while a turn is live; otherwise the SHAPE says the type — a
            // bolt for a trigger run, a dot for a chat — and the colour still carries the gate.
            const amber = session.waiting ? "text-[var(--ag-run-status-warning)]" : undefined
            if (session.running)
                return createElement(LoaderCircle, {size: 12, className: "animate-spin"})
            if (session.isAutomation)
                return createElement(Zap, {
                    size: 12,
                    // Fill means LIVE on both glyphs; the bolt shape alone says automation.
                    fill: session.waiting || session.alive ? "currentColor" : "none",
                    className: amber,
                })
            return createElement(Circle, {
                size: 8,
                fill: session.waiting || session.alive ? "currentColor" : "none",
                className: amber,
            })
        },
        // Archived rows read as second-class: same row, dimmed. The archived view is the only
        // place they appear, so this says WHICH list you are looking at as much as which row.
        getRowClassName: (session) => (session.archived ? "opacity-60" : undefined),
        // Grouped by owning agent, pins in their own heading on top (#6125).
        getGroupKey: sidebarSessionGroupKey,
        groupsAtom: sidebarSessionGroupsAtomFamily(MOBILE_NAV_SCOPE_ID),
        toggleGroupAtom: sidebarSessionToggledGroupsAtomFamily(MOBILE_NAV_SCOPE_ID),
        // No visible cap: the rail renders every row it fetched, so nothing is dropped between
        // the request and the render. The server window is the only bound.
        maxItems: sidebarSessionScopeLimit(MOBILE_NAV_SCOPE_ID),
    },
)

/**
 * Same shape for agents, over the roster query the Agents screen already reads — so opening the
 * group costs nothing once that screen has run. Children land on mobile's own agent overview.
 */
const mobileAgentsEntity = defineSidebarEntity(MOBILE_NAV_SCOPE_ID, AGENTS_SIDEBAR_KEY, {
    kind: "app",
    icon: createElement(Bot, {size: 14}),
    // Per row: this agent's own glyph, falling back to the shared one.
    getIcon: (workflow) =>
        createElement(AgentGlyph, {
            workflowId: workflow.id,
            size: 14,
            fallback: createElement(Bot, {size: 14}),
        }),
    listAtom: agentWorkflowsListQueryStateAtom,
    getLabel: (workflow) => workflow.name || workflow.slug || "Untitled agent",
    childPath: (workflow) => `/agents/${workflow.id}`,
    emptyLabel: "No agents",
    showAllPath: "/agents",
})

/**
 * The rail's nav model — the same keys, order and icon sizes the desktop rail uses, narrowed
 * to the screens mobile has. Entries appear here as their screens land; nothing is hidden by
 * forking a component.
 */
export const useMobileNavItems = (projectURL: string): SidebarConfig[] => {
    const rawSource = useAtomValue(mobileSessionsEntity.activeSourceAtom)
    const groups = useAtomValue(sidebarSessionGroupsAtomFamily(MOBILE_NAV_SCOPE_ID))
    // MEMOIZED, and load-bearing: `withEntityGroups` spreads into a new object, so an unmemoized
    // call changes identity on every render — which busts the memo below, re-buckets every row,
    // and hands `NavMenu` a new items array that defeats its own memo.
    const source = useMemo(() => withEntityGroups(rawSource, groups), [rawSource, groups])
    // Busiest agent first, by session count — stable session to session (frozen per page load),
    // where recency reshuffled on every turn. Agents with no session keep catalog order below.
    const rawAgentsSource = useAtomValue(mobileAgentsEntity.activeSourceAtom)
    const agentRanks = useAtomValue(sidebarAgentRanksAtomFamily(MOBILE_NAV_SCOPE_ID))
    const agentsSource = useMemo(
        () => withRefsByRecency(rawAgentsSource, (ref) => agentRanks.get(ref.id)),
        [agentRanks, rawAgentsSource],
    )
    // Resolved ONCE for the rail, not once per row: the verbs do not differ by session.
    const chrome = useSessionRowChrome(useSessionActions())
    const wrapSessionRow = useCallback(
        (ref: SidebarEntityRef, node: ReactNode) =>
            createElement(SessionRowActions, {
                session: ref as SessionSidebarRef,
                chrome,
                children: node,
            }),
        [chrome],
    )

    return useMemo(
        () => [
            {
                key: "mobile-home",
                title: "Home",
                icon: createElement(House, {size: 16}),
                link: `${projectURL}/apps`,
            },
            {
                key: AGENTS_SIDEBAR_KEY,
                title: "Agents",
                icon: createElement(Bot, {size: 16}),
                link: `${projectURL}/agents`,
                // Collapsed rail: navigate to the section instead of flyout-ing the list, the
                // same call the desktop rail makes. The icon's obvious meaning is "take me
                // there", and a long popover is a list to read rather than a menu to pick from.
                hideChildrenWhenCollapsed: true,
                submenu: resolveChildren(mobileAgentsEntity, agentsSource, projectURL),
            },
            {
                key: SESSIONS_SIDEBAR_KEY,
                title: "Sessions",
                icon: createElement(MessagesSquare, {size: 16}),
                link: `${projectURL}/sessions`,
                hideChildrenWhenCollapsed: true,
                // No collapse caret here: the filter control is this group's affordance, and the
                // rows are grouped and individually collapsible already.
                alwaysOpen: true,
                // The rail does not scroll; THIS group does. Sessions is the only list that grows
                // without bound, so Observability (and whatever lands after it) stays on screen.
                scrollChildren: true,
                groupAction: createElement(SessionFilterMenu, {
                    scopeId: MOBILE_NAV_SCOPE_ID,
                }),
                submenu: resolveChildren(
                    mobileSessionsEntity,
                    source,
                    projectURL,
                    undefined,
                    undefined,
                    wrapSessionRow,
                ),
            },
            {
                key: "mobile-observability",
                title: "Observability",
                icon: createElement(Activity, {size: 16}),
                link: `${projectURL}/observability`,
            },
        ],
        [agentsSource, source, projectURL, wrapSessionRow],
    )
}

/**
 * The pinned bottom entries — the desktop rail's, minus what has no mobile destination.
 * Settings is a placeholder screen until its surfaces land; Help & Docs is the SHARED entry, so
 * both apps point at the same destinations. Invite Teammate is desktop-only: inviting is
 * workspace administration, not something this app is for.
 */
// Lazy-load package.json so its version stays out of the initial bundle — same as the desktop.
// `unwrap` yields undefined until the import settles, which is all the suffix below needs.
const versionAtom = unwrap(atom(async () => (await import("../../../package.json")).version))

export const useMobileBottomNavItems = (
    projectURL: string,
    {includeSettingsLink = true}: {includeSettingsLink?: boolean} = {},
): SidebarConfig[] => {
    const version = useAtomValue(versionAtom)

    return useMemo(
        () => [
            // The settings scope drops it: the rail IS settings there, as on the desktop.
            ...(includeSettingsLink
                ? [
                      {
                          key: "mobile-settings",
                          title: "Settings",
                          icon: createElement(Settings, {size: 16}),
                          link: `${projectURL}/settings`,
                      },
                  ]
                : []),
            buildHelpDocsNavItem({
                icons: {
                    help: createElement(HelpCircle, {size: 16}),
                    docs: createElement(ScrollText, {size: 14}),
                    github: createElement(Github, {size: 14}),
                    slack: createElement(Slack, {size: 14}),
                    bookCall: createElement(CalendarClock, {size: 14}),
                },
                suffix: version
                    ? createElement(
                          "span",
                          {className: "text-[10px] leading-none text-colorTextTertiary"},
                          `v${version}`,
                      )
                    : undefined,
            }),
        ],
        [includeSettingsLink, projectURL, version],
    )
}
