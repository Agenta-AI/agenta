import {memo, useCallback, useMemo} from "react"

import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {
    setSidebarPopupGroupOpenAtom,
    sidebarCollapsedAtom,
    sidebarOpenGroupsAtomFamily,
} from "@/oss/lib/atoms/sidebar"

import {useAppTheme} from "../Layout/ThemeContextProvider"

import SidebarShell from "./engine/SidebarShell"
import {mainSidebarScope} from "./scopes/mainScope"
import {createSettingsSidebarScope} from "./scopes/settingsScope"

const Sidebar: React.FC<{showSettingsView?: boolean; lastPath?: string}> = ({
    showSettingsView,
    lastPath,
}) => {
    const {appTheme} = useAppTheme()
    const router = useRouter()
    const setSidebarPopupGroupOpen = useSetAtom(setSidebarPopupGroupOpenAtom)
    const settingsScope = useMemo(() => createSettingsSidebarScope({lastPath}), [lastPath])
    const scope = showSettingsView ? settingsScope : mainSidebarScope
    const handlePopupOpenChange = useCallback(
        (key: string, open: boolean) => {
            setSidebarPopupGroupOpen({key, open})
        },
        [setSidebarPopupGroupOpen],
    )

    return (
        <SidebarShell
            key={scope.id}
            collapsedAtom={sidebarCollapsedAtom}
            currentPath={router.asPath}
            onPopupOpenChange={handlePopupOpenChange}
            openGroupsAtomFamily={sidebarOpenGroupsAtomFamily}
            scope={scope}
            theme={appTheme}
        />
    )
}

export default memo(Sidebar)
