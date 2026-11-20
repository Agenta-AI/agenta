import {createElement, useCallback, useEffect, useMemo, type ReactNode} from "react"

import {promptWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {createT, useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import commonCatalog from "@agenta/i18n/catalogs/common"
import agentSectionsCatalog from "@agenta/i18n/catalogs/nav.agentSections"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {
    AGENTS_SIDEBAR_KEY,
    buildHelpDocsNavItem,
    buildInviteTeammateNavItem,
    defineSidebarEntity,
    resolveChildren,
    SESSIONS_SIDEBAR_KEY,
    SKILLS_SIDEBAR_KEY,
    sidebarSessionToggledGroupsAtomFamily,
    sidebarSessionGroupKey,
    sidebarSessionGroupsAtomFamily,
    loadMoreSidebarSessionsAtomFamily,
    sidebarSessionPageCountAtomFamily,
    sidebarSessionsNeedNextPageAtomFamily,
    RELEASES,
    SIDEBAR_UNBOUNDED,
    sidebarSessionsListAtomFamily,
    setSidebarSessionFilterDefaults,
    withEntityGroups,
    type SessionSidebarRef,
    type SidebarConfig,
    type SidebarEntityRef,
} from "@agenta/navigation"
import {buildReleaseNavItems, SessionFilterMenu, SessionSearchButton} from "@agenta/navigation-ui"
import {sessionRoutePath} from "@agenta/sessions/link"
import {
    SessionRowActions,
    useSessionActions,
    useSessionRowChrome,
    type SessionActionTarget,
    type SessionRowTarget,
} from "@agenta/sessions-ui"
import {betaDeveloperModeActiveAtom, userAtom} from "@agenta/shared/state"
import {getShortcut, shortcutAria, shortcutFaces} from "@agenta/shared/utils"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {useIsMacPlatform} from "@agenta/ui/shortcuts"
import {Spinner} from "@agenta/ui/ui"
import {
    ChatsIcon,
    GearIcon,
    GithubLogoIcon,
    CompassIcon,
    HouseIcon,
    KeyboardIcon,
    LightningIcon,
    PaperPlaneIcon,
    QuestionIcon,
    RobotIcon,
    ScrollIcon,
    SlackLogoIcon,
    SquaresFourIcon,
} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {unwrap} from "jotai/utils"
import {useRouter} from "next/router"

import {sessionBullet} from "@/features/agent-sidebar/agentSidebarItems"
import {openAgentSidebar} from "@/features/agent-sidebar/selectedSidebar"
import {agentEntryHref} from "@/features/agents/agentEntry"
import {shareDialogRequestAtom} from "@/features/chat/shareDialogState"
import {useLeaveSession} from "@/features/chat/useLeaveSession"
import {startBlankSession} from "@/features/chat/useStartBlankSession"
import {useEnabledDeveloperViews} from "@/features/developer/developerViewAccess"
import {whatsNewAtom} from "@/features/education/whatsNewAtom"

import {useProjectPermission} from "../context/useProjectPermission"

import {AgentsNavAction} from "./AgentsNavAction"
import {AgentsQuickPanel} from "./AgentsQuickPanel"
import {developerNavSlots, PROMPTS_ROW_KEY} from "./developerNavSlots"
import {useSyncLocalSessionRefs} from "./localSessionRefs"

/** Outside React: the row-level labels the entity registry builds at call time. */
const tNow = createT(navigationCatalog)
const tAgentSections = createT(agentSectionsCatalog)

/** How many sessions an agent section of the main sidebar lists. */
export const AGENT_SECTION_SESSION_LIMIT = 4

/** The drawer's scope id — its open-groups persistence bucket. */
export const MOBILE_NAV_SCOPE_ID = "mobile-main"
// By agent, not the shared flat default: the rail's "+" lives on agent headings, and a heading
// that is a date or a status names no agent to start a session with. Reset comes back here.
setSidebarSessionFilterDefaults(MOBILE_NAV_SCOPE_ID, {groupBy: "agent"})
/** The registry entry for ⌘K / Ctrl+K, which `MobileCommandPalette` binds. */
const PALETTE_SHORTCUT_ID = "palette.open"

/**
 * Mobile's registration over the SHARED machinery: same gated sessions source, same
 * pinned-first ordering, mobile's own child routes.
 */
export const mobileSessionsEntity = defineSidebarEntity<SessionSidebarRef>(
    MOBILE_NAV_SCOPE_ID,
    SESSIONS_SIDEBAR_KEY,
    {
        kind: "app",
        icon: createElement(ChatsIcon, {size: 14}),
        // Its OWN scope: the source reads that scope's filters, so the desktop rail's filters
        // cannot narrow this drawer. Mobile has no filter UI, so this scope keeps the defaults.
        listAtom: sidebarSessionsListAtomFamily(MOBILE_NAV_SCOPE_ID),
        getLabel: (session) => session.name || tNow("navigation.items.untitledSession"),
        childPath: (session) => `/sessions/${session.sessionId}`,
        emptyLabel: "No sessions yet",
        // No caret on this row to protect, and "No sessions yet" under a heading that already
        // says Sessions is the same sentence twice.
        hideWhenEmpty: true,
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
            const live = session.waiting || session.alive
            if (session.running) return createElement(Spinner, {className: "size-3"})
            if (session.isAutomation)
                return createElement(LightningIcon, {
                    size: 12,
                    // Fill means LIVE on both glyphs; the bolt shape alone says automation.
                    weight: live ? "fill" : "regular",
                    className: amber,
                })
            return sessionBullet(session.waiting ? "waiting" : live ? "live" : "idle")
        },
        // Archived rows read as second-class: same row, dimmed. The archived view is the only
        // place they appear, so this says WHICH list you are looking at as much as which row.
        getRowClassName: (session) => (session.archived ? "opacity-60" : undefined),
        // Grouped by owning agent, pins in their own heading on top (#6125).
        getGroupKey: sidebarSessionGroupKey,
        groupsAtom: sidebarSessionGroupsAtomFamily(MOBILE_NAV_SCOPE_ID),
        // An agent heading's "+" opens a blank session with that agent — the same start every
        // other "+" in the app makes. The session id is minted on the click, so the anchor's
        // own href is the agent entry link: what a long-press / open-in-new-tab lands on.
        groupAdd: (group, projectURL) =>
            group.agentId
                ? {
                      link: agentEntryHref(projectURL, group.agentId),
                      label: tNow("navigation.items.newSessionWith", {agent: group.label}),
                      onClick: (event) => {
                          event.preventDefault()
                          startBlankSession(projectURL, group.agentId!)
                      },
                  }
                : undefined,
        // The open button shows that agent's sidebar in place of this one; the page stays.
        groupEnter: (group) =>
            group.agentId
                ? {
                      label: tAgentSections("nav.agentSections.openAgent", {agent: group.label}),
                      onClick: () => openAgentSidebar(group.agentId!, "main"),
                  }
                : undefined,
        // Each agent section lists its latest sessions; the Sessions page lists them all.
        groupMaxItems: (group) => (group.agentId ? AGENT_SECTION_SESSION_LIMIT : undefined),
        toggleGroupAtom: sidebarSessionToggledGroupsAtomFamily(MOBILE_NAV_SCOPE_ID),
        // No cap on the whole list: the server window bounds it. Each agent section shows its
        // latest sessions only (`groupMaxItems`); pinned rows and the date or status headings
        // show every row they fetched.
        maxItems: SIDEBAR_UNBOUNDED,
    },
)

/**
 * The prompt apps under the beta developer mode Prompts row, as in the old app. The list loads
 * only while the row is open.
 */
export const mobilePromptsEntity = defineSidebarEntity<Workflow>(
    MOBILE_NAV_SCOPE_ID,
    PROMPTS_ROW_KEY,
    {
        kind: "app",
        icon: createElement(SquaresFourIcon, {size: 14}),
        listAtom: promptWorkflowsListQueryStateAtom,
        getLabel: (workflow) =>
            workflow.name || workflow.slug || tNow("navigation.items.untitledPrompt"),
        childPath: (workflow) => `/apps/${workflow.id}/playground`,
        emptyLabel: "No prompts",
        showAllPath: "/prompts",
    },
)

/**
 * Wraps a rail session row with its verbs (the kebab and the right-click menu, rename in place).
 * The main sidebar and the agent sidebar both use it, so a row behaves the same in each.
 */
export const useRailSessionRowWrapper = (projectURL: string) => {
    // Resolved ONCE for the rail, not once per row: the verbs do not differ by session.
    // Archiving or deleting the session on screen has to move you off it, from here too.
    // Sharing: the owner's rail menu has Share; someone else's chat keeps only Open-like verbs.
    const me = useAtomValue(userAtom)
    const openShare = useSetAtom(shareDialogRequestAtom)
    const onShare = useCallback(
        (target: SessionActionTarget) => {
            const [, , workspaceId = "", , projectId = ""] = projectURL.split("/")
            openShare({
                sessionId: target.sessionId,
                sessionName: target.name ?? "",
                workspaceId,
                projectId,
                agentId: target.appId,
            })
        },
        [openShare, projectURL],
    )
    // "Copy share link" in the rail too (approved session row menu, QA D7): the session's own
    // page, with the app's `/m` prefix.
    const router = useRouter()
    const sharePathFor = useCallback(
        ({sessionId}: SessionActionTarget) =>
            `${router.basePath}${sessionRoutePath(projectURL, sessionId)}`,
        [projectURL, router.basePath],
    )
    const chrome = useSessionRowChrome(
        useSessionActions({
            onRemoved: useLeaveSession(projectURL),
            currentUserId: me?.id ?? null,
            onShare,
            sharePathFor,
        }),
    )
    return useCallback(
        (session: SessionRowTarget, node: ReactNode) =>
            createElement(SessionRowActions, {
                session,
                chrome,
                children: node,
            }),
        [chrome],
    )
}

/** The chord that opens the search window, for the search buttons' tooltips. */
export const usePaletteShortcut = () => {
    // Platform read in an effect: the server has none, and a guess mismatches on hydration.
    const mac = useIsMacPlatform()
    return useMemo(() => {
        const shortcut = getShortcut(PALETTE_SHORTCUT_ID)
        return shortcut
            ? {faces: shortcutFaces(shortcut, mac), aria: shortcutAria(PALETTE_SHORTCUT_ID)}
            : undefined
    }, [mac])
}

/**
 * The rail's nav model — the same keys, order and icon sizes the desktop rail uses, narrowed
 * to the screens mobile has. Entries appear here as their screens land; nothing is hidden by
 * forking a component.
 */
export const useMobileNavItems = (projectURL: string): SidebarConfig[] => {
    const t = useT(navigationCatalog)
    const tBuilder = useT(builderPageCatalog)
    // Sessions this client created ride the shared local seam until the server lists them.
    useSyncLocalSessionRefs(MOBILE_NAV_SCOPE_ID)
    const rawSource = useAtomValue(mobileSessionsEntity.activeSourceAtom)
    const loadMoreSessions = useSetAtom(loadMoreSidebarSessionsAtomFamily(MOBILE_NAV_SCOPE_ID))
    // Each agent section shows 4 rows, so the rail can be too short to scroll while agents with
    // older sessions are still on later pages: ask for the next page without a scroll.
    const needNextPage = useAtomValue(sidebarSessionsNeedNextPageAtomFamily(MOBILE_NAV_SCOPE_ID))
    // Read so the effect runs again after each page, also when a page came from the cache and
    // the answer stayed true.
    const pages = useAtomValue(sidebarSessionPageCountAtomFamily(MOBILE_NAV_SCOPE_ID))
    useEffect(() => {
        if (needNextPage) loadMoreSessions()
    }, [needNextPage, pages, loadMoreSessions])
    const groups = useAtomValue(sidebarSessionGroupsAtomFamily(MOBILE_NAV_SCOPE_ID))
    // MEMOIZED, and load-bearing: `withEntityGroups` spreads into a new object, so an unmemoized
    // call changes identity on every render — which busts the memo below, re-buckets every row,
    // and hands `NavMenu` a new items array that defeats its own memo.
    const source = useMemo(() => withEntityGroups(rawSource, groups), [rawSource, groups])
    const paletteShortcut = usePaletteShortcut()
    const developerViews = useEnabledDeveloperViews()
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    const wrapSession = useRailSessionRowWrapper(projectURL)
    const wrapSessionRow = useCallback(
        (ref: SidebarEntityRef, node: ReactNode) => wrapSession(ref as SessionSidebarRef, node),
        [wrapSession],
    )

    const promptsSource = useAtomValue(mobilePromptsEntity.activeSourceAtom)
    const developerSlots = useMemo(
        () =>
            developerNavSlots(
                projectURL,
                developerViews,
                developerMode,
                developerMode
                    ? resolveChildren(mobilePromptsEntity, promptsSource, projectURL)
                    : [],
                t,
            ),
        [developerMode, developerViews, projectURL, promptsSource, t],
    )

    return useMemo(
        () => [
            // Builder first, then Home: the design's order.
            {
                key: "mobile-builder",
                title: tBuilder("builder.page.builder"),
                icon: createElement(BuilderIcon, {size: 16}),
                link: `${projectURL}/builder`,
            },
            {
                key: "mobile-home",
                title: t("navigation.items.home"),
                icon: createElement(HouseIcon, {size: 16}),
                link: `${projectURL}/apps`,
            },
            ...developerSlots.afterHome,
            {
                key: AGENTS_SIDEBAR_KEY,
                title: t("navigation.items.agents"),
                icon: createElement(RobotIcon, {size: 16}),
                link: `${projectURL}/agents`,
                // Start or open an agent without leaving the page: a "+" on the row, the same
                // panel as a hover flyout on the collapsed rail.
                rowAction: createElement(AgentsNavAction, {base: projectURL}),
                hoverFlyout: (close: () => void, hold: (held: boolean) => void) =>
                    createElement(AgentsQuickPanel, {
                        base: projectURL,
                        onDone: close,
                        onBusyChange: hold,
                        autoFocusSearch: false,
                    }),
            },
            // After Agents: an automation is something an agent has, and Skills is what it uses.
            {
                key: "automations",
                title: t("navigation.items.automations"),
                icon: createElement(LightningIcon, {size: 16}),
                link: `${projectURL}/automations`,
            },
            {
                key: SKILLS_SIDEBAR_KEY,
                title: t("navigation.items.skills"),
                icon: createElement(CompassIcon, {size: 16}),
                link: `${projectURL}/skills`,
            },
            {
                key: SESSIONS_SIDEBAR_KEY,
                title: t("navigation.items.sessions"),
                icon: createElement(ChatsIcon, {size: 16}),
                link: `${projectURL}/sessions`,
                hideChildrenWhenCollapsed: true,
                // No collapse caret here: the filter control is this group's affordance, and the
                // rows are grouped and individually collapsible already.
                alwaysOpen: true,
                // The rail does not scroll; THIS group does. Sessions is the only list that grows
                // without bound, so Observability (and whatever lands after it) stays on screen.
                scrollChildren: true,
                onReachEnd: loadMoreSessions,
                // Search reaches past what the rail lists; the filter narrows it. Same pair,
                // same order, as the desktop rail.
                groupAction: createElement(
                    "span",
                    {className: "flex items-center gap-0.5"},
                    createElement(SessionSearchButton, {
                        label: t("navigation.items.search"),
                        shortcut: paletteShortcut,
                    }),
                    createElement(SessionFilterMenu, {scopeId: MOBILE_NAV_SCOPE_ID}),
                ),
                submenu: resolveChildren(
                    mobileSessionsEntity,
                    source,
                    projectURL,
                    undefined,
                    undefined,
                    wrapSessionRow,
                ),
            },
            ...developerSlots.afterSessions,
        ],
        [
            loadMoreSessions,
            source,
            projectURL,
            wrapSessionRow,
            paletteShortcut,
            developerSlots,
            t,
            tBuilder,
        ],
    )
}

// Lazy-load package.json so its version stays out of the initial bundle.
// `unwrap` yields undefined until the import settles, which is all the suffix below needs.
const versionAtom = unwrap(atom(async () => (await import("../../../package.json")).version))

export const useMobileVersion = () => useAtomValue(versionAtom)

/** Templates and Settings (not in the settings scope), plus Invite Teammate in beta developer mode. */
export const useMobileBottomNavItems = (
    projectURL: string,
    {includeSettingsLink = true}: {includeSettingsLink?: boolean} = {},
): SidebarConfig[] => {
    const t = useT(navigationCatalog, commonCatalog)
    const version = useMobileVersion()
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    // No project id, no permission request: outside beta developer mode nothing is asked.
    const [, , , , projectId = ""] = projectURL.split("/")
    const canInvite = useProjectPermission(
        developerMode ? projectId : "",
        "add_new_user_to_workspace",
    )
    const inviteItems = useMemo(
        () =>
            developerMode && canInvite
                ? [
                      {
                          ...buildInviteTeammateNavItem({
                              projectURL,
                              icon: createElement(PaperPlaneIcon, {size: 16}),
                          }),
                          title: t("navigation.items.inviteTeammate"),
                          tooltip: t("navigation.items.inviteTeammate"),
                      },
                  ]
                : [],
        [canInvite, developerMode, projectURL, t],
    )
    const items = useMemo(
        () =>
            // The settings scope drops them: the rail IS settings there.
            includeSettingsLink
                ? [
                      {
                          key: "mobile-templates",
                          title: t("navigation.items.templates"),
                          icon: createElement(SquaresFourIcon, {size: 16}),
                          link: `${projectURL}/templates`,
                      },
                      {
                          key: "mobile-settings",
                          title: t("common.settings"),
                          icon: createElement(GearIcon, {size: 16}),
                          link: `${projectURL}/settings`,
                          suffix: version
                              ? createElement(
                                    "span",
                                    {className: "text-[12px] leading-4 text-colorTextTertiary"},
                                    `v${version}`,
                                )
                              : undefined,
                      },
                  ]
                : [],
        [includeSettingsLink, projectURL, version, t],
    )
    return useMemo(
        () => (inviteItems.length ? [...items, ...inviteItems] : items),
        [inviteItems, items],
    )
}

/**
 * Help & Docs as an item the rail renders as an icon button beside the project switcher, the
 * same place the desktop rail puts it. It is a menu you reach for, not a place in the product,
 * and the row it held was the widest thing in the rail's footer.
 */
export const useMobileHelpItem = ({
    onOpenShortcuts,
}: {onOpenShortcuts?: () => void} = {}): SidebarConfig => {
    const t = useT(navigationCatalog)
    const version = useMobileVersion()
    const openWhatsNew = useSetAtom(whatsNewAtom)

    return useMemo(() => {
        const help = buildHelpDocsNavItem({
            icons: {
                help: createElement(QuestionIcon, {size: 16}),
                docs: createElement(ScrollIcon, {size: 14}),
                github: createElement(GithubLogoIcon, {size: 14}),
                slack: createElement(SlackLogoIcon, {size: 14}),
            },
            extraItems: [
                {
                    key: "keyboard-shortcuts",
                    title: t("navigation.items.keyboardShortcuts"),
                    icon: createElement(KeyboardIcon, {size: 14}),
                    isHidden: !onOpenShortcuts,
                    onClick: () => onOpenShortcuts?.(),
                    // The rule between the destinations and the release list.
                    divider: true,
                },
                // Release rows reopen the what's-new dialog; "View all releases" links out.
                ...buildReleaseNavItems(version, {
                    whatsNew: t("navigation.items.whatsNew"),
                    viewAll: t("navigation.items.viewAllReleases"),
                }).map((item) =>
                    RELEASES.some((release) => release.id === item.key)
                        ? {
                              ...item,
                              link: undefined,
                              onClick: () => openWhatsNew({releaseId: item.key}),
                          }
                        : item,
                ),
            ],
        })
        // The shared builder carries English titles; the shell supplies the visible text.
        const titles: Record<string, string> = {
            docs: t("navigation.items.documentation"),
            "github-support": t("navigation.items.githubSupport"),
            "slack-connect": t("navigation.items.slackSupport"),
        }
        return {
            ...help,
            title: t("navigation.items.helpDocs"),
            submenu: help.submenu?.map((item) =>
                titles[item.key] ? {...item, title: titles[item.key]} : item,
            ),
        }
    }, [onOpenShortcuts, openWhatsNew, t, version])
}
