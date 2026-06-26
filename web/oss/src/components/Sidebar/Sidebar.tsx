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
import type {SidebarView} from "./types"

const resolveSidebarScope = (view: SidebarView) => {
    switch (view.id) {
        case "main":
            return mainSidebarScope
        case "settings":
            return createSettingsSidebarScope({lastPath: view.lastPath ?? undefined})
        default: {
            const exhaustiveCheck: never = view
            return exhaustiveCheck
        }
    }
}

const Sidebar: React.FC<{view: SidebarView}> = ({view}) => {
    const {appTheme} = useAppTheme()
    const router = useRouter()
    const setSidebarPopupGroupOpen = useSetAtom(setSidebarPopupGroupOpenAtom)
    const scope = useMemo(() => resolveSidebarScope(view), [view])
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
