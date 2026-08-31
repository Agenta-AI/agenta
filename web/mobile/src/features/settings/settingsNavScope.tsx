import {useMemo} from "react"

import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SETTINGS_SIDEBAR_SCOPE_ID} from "@agenta/navigation"
import {SidebarBackButton, SidebarToggleButton} from "@agenta/navigation-ui"
import {
    buildSettingsSidebarSections,
    getSettingsSidebarTabs,
    isSettingsTabKey,
} from "@agenta/settings"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {DrawerProjectSwitcher} from "../nav/DrawerProjectSwitcher"
import {lastNonSettingsPathAtom} from "../nav/lastNonSettingsPath"
import {useMobileBottomNavItems} from "../nav/useMobileNavItems"

import {
    AVAILABLE_SETTINGS_TABS,
    useActiveSettingsTab,
    useMobileSettingsAccess,
} from "./settingsTabs"

/**
 * Settings TAKES OVER the rail, the way oss/ee do it: the main nav is replaced by the settings
 * groups, its header becomes "← Back", and the page carries no top bar. Same shared builder as
 * the desktop scope, so the two rails cannot drift; only routing and the bottom section differ.
 *
 * Built per workspace/project like `mobileNavScope`, so the slot components keep stable
 * identities across renders.
 */
const createSettingsNavScope = (workspaceId: string, projectId: string): SidebarScope => {
    const projectURL = `/w/${workspaceId}/p/${projectId}`
    const settingsURL = `${projectURL}/settings`

    const useSelection = (): SidebarSelection => {
        const router = useRouter()
        const activeTab = useActiveSettingsTab()

        return {
            mode: "controlled",
            selectedKey: activeTab,
            onSelect: (key) => {
                if (!isSettingsTabKey(key)) return
                void router.replace({query: {...router.query, tab: key}}, undefined, {
                    shallow: true,
                })
            },
        }
    }

    const useSections = (): SidebarSection[] => {
        const access = useMobileSettingsAccess()
        const bottomItems = useMobileBottomNavItems(projectURL, {includeSettingsLink: false})

        return useMemo(
            () => [
                ...buildSettingsSidebarSections(
                    getSettingsSidebarTabs(access).filter((tab) =>
                        AVAILABLE_SETTINGS_TABS.includes(tab.key),
                    ),
                    // A real href per tab: the drawer closes on link clicks, and the controlled
                    // selection intercepts the navigation before it happens.
                    {getLink: (key) => `${settingsURL}?tab=${key}`},
                ),
                {
                    key: "bottom",
                    items: bottomItems,
                    placement: "bottom",
                    mode: "vertical",
                },
            ],
            [access, bottomItems],
        )
    }

    const Header = ({collapsed, onDismiss}: SidebarSlotContext) => {
        const router = useRouter()
        const lastPath = useAtomValue(lastNonSettingsPathAtom)

        return (
            <div
                className={[
                    "mb-1 flex w-full shrink-0 items-center",
                    // The collapsed rail is 48px wide, too narrow for Back and the toggle side by
                    // side, so stack them instead of squeezing both into one row.
                    collapsed
                        ? "flex-col justify-center gap-1 py-1"
                        : "h-[48px] justify-between px-1.5",
                ].join(" ")}
            >
                <SidebarBackButton
                    collapsed={collapsed}
                    onBack={() => void router.push(lastPath ?? `${projectURL}/apps`)}
                />
                <SidebarToggleButton onDismiss={onDismiss} />
            </div>
        )
    }

    const AfterBottom = () => (
        <DrawerProjectSwitcher workspaceId={workspaceId} projectId={projectId} />
    )

    return {
        id: SETTINGS_SIDEBAR_SCOPE_ID,
        useSelection,
        useSections,
        header: Header,
        afterBottom: AfterBottom,
    }
}

export const useSettingsNavScope = (workspaceId: string, projectId: string) =>
    useMemo(() => createSettingsNavScope(workspaceId, projectId), [workspaceId, projectId])
