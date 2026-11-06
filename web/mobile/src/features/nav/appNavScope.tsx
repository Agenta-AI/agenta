import {useMemo} from "react"

import type {
    SidebarConfig,
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SidebarBackButton, SidebarToggleButton} from "@agenta/navigation-ui"
import {
    TreeViewIcon,
    DesktopIcon,
    FlaskIcon,
    LightningIcon,
    RocketIcon,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useEnabledDeveloperViews} from "../developer/developerViewAccess"
import type {DeveloperView} from "../developer/developerViews"
import {CreditsRemainingWidget} from "../wallet/CreditsRemainingWidget"

import {lastMainRailPathAtom} from "./appRoute"
import {DrawerProjectSwitcher} from "./DrawerProjectSwitcher"
import {useMobileBottomNavItems} from "./useMobileNavItems"

/** The app menu's scope id: its own open-groups bucket, apart from the main rail's. */
export const MOBILE_APP_NAV_SCOPE_ID = "mobile-app"

/** The old app's app menu, with its labels and URLs. */
export const appNavItems = (
    projectURL: string,
    appId: string,
    views: readonly DeveloperView[],
): SidebarConfig[] => {
    const appURL = `${projectURL}/apps/${encodeURIComponent(appId)}`
    // Each row with the developer view that must be on for it; Observability is not a view.
    const rows: [viewId: string | null, row: SidebarConfig][] = [
        [
            "app-overview",
            {
                key: "app-overview",
                title: "Overview",
                icon: <DesktopIcon size={16} />,
                link: `${appURL}/overview`,
            },
        ],
        [
            "playground",
            {
                key: "app-playground",
                title: "Playground",
                icon: <RocketIcon size={16} />,
                link: `${appURL}/playground`,
            },
        ],
        [
            "variants",
            {
                key: "app-registry",
                title: "Registry",
                icon: <LightningIcon size={16} />,
                link: `${appURL}/variants`,
            },
        ],
        [
            "evaluations",
            {
                key: "app-evaluations",
                title: "Evaluations",
                icon: <FlaskIcon size={16} />,
                link: `${appURL}/evaluations`,
            },
        ],
        [
            null,
            {
                key: "app-observability",
                title: "Observability",
                icon: <TreeViewIcon size={16} />,
                link: `${appURL}/traces`,
            },
        ],
    ]
    return rows
        .filter(([viewId]) => !viewId || views.some((view) => view.id === viewId))
        .map(([, row]) => ({...row, prefetch: false}))
}

/** The switcher reads the app catalog, so its code and data load only inside an app. */
const AppSwitcher = dynamic(() => import("./AppSwitcher").then((m) => m.AppSwitcher), {
    ssr: false,
    loading: () => <span className="block h-8 w-full" aria-hidden />,
})

const ROUTE_SELECTION: SidebarSelection = {mode: "route"}

/** The app menu of one app. `railScope` loads this module only inside an app. */
export const createMobileAppNavScope = (
    workspaceId: string,
    projectId: string,
    appId: string,
): SidebarScope => {
    const projectURL = `/w/${workspaceId}/p/${projectId}`

    const useSections = (): SidebarSection[] => {
        const views = useEnabledDeveloperViews()
        const bottomItems = useMobileBottomNavItems(projectURL)
        return useMemo(
            () => [
                {key: "app", items: appNavItems(projectURL, appId, views)},
                {key: "bottom", items: bottomItems, placement: "bottom", mode: "vertical"},
            ],
            [bottomItems, views],
        )
    }

    const Header = ({collapsed, onDismiss}: SidebarSlotContext) => {
        const router = useRouter()
        const lastPath = useAtomValue(lastMainRailPathAtom)
        const back = (
            <SidebarBackButton
                collapsed={collapsed}
                onBack={() => void router.push(lastPath ?? `${projectURL}/prompts`)}
            />
        )
        const toggle = <SidebarToggleButton onDismiss={onDismiss} />
        const row =
            "flex w-full shrink-0 items-center border-0 border-b border-solid border-[var(--ag-shell-line)]"
        return (
            <>
                {/* Collapsed, the toggle keeps the spot every collapsed rail gives it, and Back
                    takes the next row; expanded, Back and the toggle share one row. */}
                <div
                    className={`${row} h-[45px] ${collapsed ? "justify-center" : "justify-between px-1.5"}`}
                >
                    {collapsed ? toggle : back}
                    {!collapsed && toggle}
                </div>
                {collapsed && <div className={`${row} h-[45px] justify-center`}>{back}</div>}
                <div className={`${row} h-[45px] ${collapsed ? "justify-center" : "px-2"}`}>
                    <AppSwitcher projectURL={projectURL} appId={appId} collapsed={collapsed} />
                </div>
            </>
        )
    }

    const AfterBottom = ({collapsed}: {collapsed: boolean}) => (
        <DrawerProjectSwitcher
            workspaceId={workspaceId}
            projectId={projectId}
            collapsed={collapsed}
        />
    )

    const Footer = ({collapsed}: SidebarSlotContext) => (
        <CreditsRemainingWidget
            projectId={projectId}
            settingsURL={`${projectURL}/settings`}
            collapsed={collapsed}
        />
    )

    return {
        id: MOBILE_APP_NAV_SCOPE_ID,
        useSelection: () => ROUTE_SELECTION,
        useSections,
        header: Header,
        footer: Footer,
        afterBottom: AfterBottom,
    }
}
