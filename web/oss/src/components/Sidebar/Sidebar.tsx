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
import {getSidebarViewDefinition} from "./scopes/viewRegistry"
import type {SidebarView} from "./types"

const Sidebar: React.FC<{view: SidebarView}> = ({view}) => {
    const {appTheme} = useAppTheme()
    const router = useRouter()
    const setSidebarPopupGroupOpen = useSetAtom(setSidebarPopupGroupOpenAtom)
    const scope = useMemo(
        () => getSidebarViewDefinition(view.id).create({lastPath: view.lastPath ?? undefined}),
        [view],
    )
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
