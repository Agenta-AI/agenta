import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
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

import {isProjectPath, projectSwitchUrl} from "@/lib/context"
import {withMobileSettingsLabels} from "@/lib/integrationsCopy"

import {DrawerProjectSwitcher} from "../nav/DrawerProjectSwitcher"
import {lastNonSettingsPathAtom} from "../nav/lastNonSettingsPath"
import {SupportActions} from "../nav/SupportActions"

import {
    AVAILABLE_SETTINGS_TABS,
    useActiveSettingsTab,
    useMobileSettingsAccess,
} from "./settingsTabs"

/**
 * Settings TAKES OVER the rail: the main nav is replaced by the settings
 * groups, its header becomes "← Settings", and the page carries no top bar.
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
        const t = useT(navigationCatalog)

        return useMemo(
            () => [
                ...buildSettingsSidebarSections(
                    withMobileSettingsLabels(
                        getSettingsSidebarTabs(access).filter((tab) =>
                            AVAILABLE_SETTINGS_TABS.includes(tab.key),
                        ),
                        t,
                    ),
                    // A real href per tab: the drawer closes on link clicks, and the controlled
                    // selection intercepts the navigation before it happens.
                    {getLink: (key) => `${settingsURL}?tab=${key}`},
                ),
            ],
            [access, t],
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
                        : "h-[48px] justify-between gap-0.5 px-2",
                ].join(" ")}
            >
                <SidebarBackButton
                    collapsed={collapsed}
                    label="Settings"
                    onBack={() =>
                        void router.push(
                            !lastPath
                                ? `${projectURL}/apps`
                                : isProjectPath(lastPath)
                                  ? projectSwitchUrl(lastPath, {workspaceId, projectId})
                                  : lastPath,
                        )
                    }
                />
                <SidebarToggleButton onDismiss={onDismiss} />
            </div>
        )
    }

    // The project switcher, in the main header's look, with live chat and help on its row.
    const AfterBottom = ({collapsed}: {collapsed: boolean}) => (
        <DrawerProjectSwitcher
            workspaceId={workspaceId}
            projectId={projectId}
            collapsed={collapsed}
            compact
            trailing={
                collapsed ? undefined : (
                    <span className="flex items-center">
                        <SupportActions projectId={projectId} />
                    </span>
                )
            }
        />
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
