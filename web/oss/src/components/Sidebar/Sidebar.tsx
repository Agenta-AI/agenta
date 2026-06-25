import {memo, useMemo} from "react"

import {useRouter} from "next/router"

import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"

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
    const settingsScope = useMemo(() => createSettingsSidebarScope({lastPath}), [lastPath])
    const scope = showSettingsView ? settingsScope : mainSidebarScope

    return (
        <SidebarShell
            key={scope.id}
            collapsedAtom={sidebarCollapsedAtom}
            currentPath={router.asPath}
            scope={scope}
            theme={appTheme}
        />
    )
}

export default memo(Sidebar)
