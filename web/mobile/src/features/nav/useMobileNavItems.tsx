import {createElement, useCallback, useMemo, type ReactNode} from "react"

import {promptWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {
    AGENTS_SIDEBAR_KEY,
    buildHelpDocsNavItem,
    defineSidebarEntity,
    resolveChildren,
    SESSIONS_SIDEBAR_KEY,
    SKILLS_SIDEBAR_KEY,
    sidebarSessionToggledGroupsAtomFamily,
    sidebarSessionGroupKey,
    sidebarSessionGroupsAtomFamily,
    loadMoreSidebarSessionsAtomFamily,
    RELEASES,
    SIDEBAR_UNBOUNDED,
    sidebarSessionsListAtomFamily,
    setSidebarSessionFilterDefaults,
    withEntityGroups,
    type SessionSidebarRef,
    type SidebarConfig,
    type SidebarEntityRef,
} from "@agenta/navigation"
import {buildReleaseNavItems, SessionFilterMenu} from "@agenta/navigation-ui"
import {sessionRoutePath} from "@agenta/sessions/link"
import {
    SessionRowActions,
    useSessionActions,
    useSessionRowChrome,
    type SessionActionTarget,
} from "@agenta/sessions-ui"
import {developerModeActiveAtom, userAtom} from "@agenta/shared/state"
import {Spinner} from "@agenta/ui/ui"
import {
    ChatsCircleIcon,
    GearIcon,
    GithubLogoIcon,
    CompassIcon,
    HouseIcon,
    KeyboardIcon,
    LightningIcon,
    QuestionIcon,
    RobotIcon,
    ScrollIcon,
    SlackLogoIcon,
    SquaresFourIcon,
} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {unwrap} from "jotai/utils"
import {MessagesSquare} from "lucide-react"
import {useRouter} from "next/router"

import {agentEntryHref} from "@/features/agents/agentEntry"
import {shareDialogRequestAtom} from "@/features/chat/shareDialogState"
import {useLeaveSession} from "@/features/chat/useLeaveSession"
import {startBlankSession} from "@/features/chat/useStartBlankSession"
import {useEnabledDeveloperViews} from "@/features/developer/developerViewAccess"
import {whatsNewAtom} from "@/features/education/whatsNewAtom"

import {AgentsNavAction} from "./AgentsNavAction"
import {AgentsQuickPanel} from "./AgentsQuickPanel"
import {developerNavSlots, PROMPTS_ROW_KEY} from "./developerNavSlots"
import {useSyncLocalSessionRefs} from "./localSessionRefs"
import {SupportActions} from "./SupportActions"

/** Outside React: the row-level labels the entity registry builds at call time. */
const tNow = createT(navigationCatalog)

/** The drawer's scope id — its open-groups persistence bucket. */
export const MOBILE_NAV_SCOPE_ID = "mobile-main"
// By agent, not the shared flat default: the rail's "+" lives on agent headings, and a heading
// that is a date or a status names no agent to start a session with. Reset comes back here.
setSidebarSessionFilterDefaults(MOBILE_NAV_SCOPE_ID, {groupBy: "agent"})

/**
 * Mobile's registration over the SHARED machinery: same gated sessions source, same
 * pinned-first ordering, mobile's own child routes.
 */
export const mobileSessionsEntity = defineSidebarEntity<SessionSidebarRef>(
    MOBILE_NAV_SCOPE_ID,
    SESSIONS_SIDEBAR_KEY,
    {
        kind: "app",
        icon: createElement(ChatsCircleIcon, {size: 14}),
        // Its OWN scope: the source reads that scope's filters, so another scope's filters
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
        // No leading glyph: a row's state shows as a quiet mark on its right (sessionStatusMark).
        getIcon: () => null,
        // Archived rows read as second-class: same row, dimmed. The archived view is the only
        // place they appear, so this says WHICH list you are looking at as much as which row.
        getRowClassName: (session) =>
            session.archived ? "opacity-60" : session.running ? RUNNING_TITLE : undefined,
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
        toggleGroupAtom: sidebarSessionToggledGroupsAtomFamily(MOBILE_NAV_SCOPE_ID),
        // No visible cap: the rail renders every row it fetched, so nothing is dropped between
        // the request and the render. The server window is the only bound.
        maxItems: SIDEBAR_UNBOUNDED,
    },
)

/** A running session's title shimmers, the same live-text sweep the chat uses. */
const RUNNING_TITLE =
    "[&_span[title]]:bg-[linear-gradient(90deg,var(--ag-colorTextQuaternary)_0%,var(--ag-colorText)_50%,var(--ag-colorTextQuaternary)_100%)] [&_span[title]]:bg-clip-text motion-safe:[&_span[title]]:animate-text-shimmer motion-safe:[&_span[title]]:bg-[length:200%_100%] motion-safe:[&_span[title]]:text-transparent"

/** A spinner while a turn runs, amber while it waits on you, dark while the session is live. */
const sessionStatusMark = (session: SessionSidebarRef): ReactNode => {
    if (session.running) return createElement(Spinner, {className: "size-2.5"})
    if (!session.waiting && !session.alive) return null
    return createElement("span", {
        "aria-label": session.waiting ? "Waiting on you" : "Live",
        className: `size-1.5 rounded-full ${session.waiting ? "bg-[var(--ag-run-status-warning)]" : "bg-colorText"}`,
    })
}

/**
 * The prompt apps under the Developer Mode Prompts row. The list loads
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
 * The rail's nav model, narrowed
 * to the screens mobile has. Entries appear here as their screens land; nothing is hidden by
 * forking a component.
 */
export interface MobileNavItems {
    /** The pages the user arranges, in their default order. */
    pages: SidebarConfig[]
    sessions: SidebarConfig
    defaultHidden: ReadonlySet<string>
}

export const useMobileNavItems = (projectURL: string): MobileNavItems => {
    const t = useT(navigationCatalog)
    // Sessions this client created ride the shared local seam until the server lists them.
    useSyncLocalSessionRefs(MOBILE_NAV_SCOPE_ID)
    const rawSource = useAtomValue(mobileSessionsEntity.activeSourceAtom)
    const loadMoreSessions = useSetAtom(loadMoreSidebarSessionsAtomFamily(MOBILE_NAV_SCOPE_ID))
    const groups = useAtomValue(sidebarSessionGroupsAtomFamily(MOBILE_NAV_SCOPE_ID))
    // MEMOIZED, and load-bearing: `withEntityGroups` spreads into a new object, so an unmemoized
    // call changes identity on every render — which busts the memo below, re-buckets every row,
    // and hands `NavMenu` a new items array that defeats its own memo.
    const source = useMemo(() => withEntityGroups(rawSource, groups), [rawSource, groups])
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
    const developerViews = useEnabledDeveloperViews()
    const developerMode = useAtomValue(developerModeActiveAtom)
    const wrapSessionRow = useCallback(
        (ref: SidebarEntityRef, node: ReactNode) =>
            createElement(SessionRowActions, {
                session: ref as SessionSidebarRef,
                chrome,
                status: sessionStatusMark(ref as SessionSidebarRef),
                children: node,
            }),
        [chrome],
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

    const pages = useMemo(() => {
        const developerRows = [...developerSlots.afterHome, ...developerSlots.afterSessions]
        const list: SidebarConfig[] = [
            {
                key: "mobile-home",
                title: t("navigation.items.home"),
                icon: createElement(HouseIcon, {size: 16}),
                link: `${projectURL}/apps`,
            },
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
            {
                key: "mobile-templates",
                title: "Templates",
                icon: createElement(SquaresFourIcon, {size: 16}),
                link: `${projectURL}/templates`,
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
            ...developerRows,
        ]
        // Templates and the developer pages start in "More".
        const defaultHidden = new Set(["mobile-templates", ...developerRows.map((row) => row.key)])
        return {pages: list, defaultHidden}
    }, [developerSlots, projectURL])

    const sessions = useMemo<SidebarConfig>(
        () => ({
            key: SESSIONS_SIDEBAR_KEY,
            title: t("navigation.items.sessions"),
            icon: createElement(MessagesSquare, {size: 16, strokeWidth: 1.5}),
            link: `${projectURL}/sessions`,
            hideChildrenWhenCollapsed: true,
            // No caret: the filter is this group's control.
            alwaysOpen: true,
            // The rail does not scroll; THIS group does, so the footer stays on screen.
            scrollChildren: true,
            onReachEnd: loadMoreSessions,
            groupAction: createElement(SessionFilterMenu, {scopeId: MOBILE_NAV_SCOPE_ID}),
            submenu: resolveChildren(
                mobileSessionsEntity,
                source,
                projectURL,
                undefined,
                undefined,
                wrapSessionRow,
            ),
        }),
        [loadMoreSessions, source, projectURL, wrapSessionRow, t],
    )

    return useMemo(() => ({...pages, sessions}), [pages, sessions])
}

// Lazy-load package.json so its version stays out of the initial bundle.
// `unwrap` yields undefined until the import settles, which is all the suffix below needs.
const versionAtom = unwrap(atom(async () => (await import("../../../package.json")).version))

const useMobileVersion = () => useAtomValue(versionAtom)

/** The Settings row, with the version and the support buttons. */
export const useMobileBottomNavItems = (projectURL: string): SidebarConfig[] => {
    const t = useT(navigationCatalog, commonCatalog)
    const version = useMobileVersion()
    const [, , , , projectId = ""] = projectURL.split("/")
    return useMemo(
        () => [
            {
                key: "mobile-settings",
                title: t("common.settings"),
                icon: createElement(GearIcon, {size: 16}),
                link: `${projectURL}/settings`,
                suffix: version
                    ? createElement(
                          "span",
                          {className: "text-[10px] leading-none text-colorTextTertiary"},
                          `v${version}`,
                      )
                    : undefined,
                trailing: createElement(SupportActions, {projectId}),
            },
        ],
        [projectId, projectURL, version, t],
    )
}

/**
 * Help & Docs as an item the rail renders as an icon button on the Settings row.
 * It is a menu you reach for, not a place in the product,
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
