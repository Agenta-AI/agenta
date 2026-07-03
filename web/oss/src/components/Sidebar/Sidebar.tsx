import {memo, useCallback, useEffect, useMemo} from "react"

import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {
    clearSidebarPopupGroupsAtom,
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
    const clearSidebarPopupGroups = useSetAtom(clearSidebarPopupGroupsAtom)
    const scope = useMemo(
        () => getSidebarViewDefinition(view.id).create({lastPath: view.lastPath ?? undefined}),
        [view.id, view.lastPath],
    )
    const handlePopupOpenChange = useCallback(
        (key: string, open: boolean) => {
            setSidebarPopupGroupOpen({scopeId: scope.id, key, open})
        },
        [scope.id, setSidebarPopupGroupOpen],
    )

    useEffect(
        () => () => {
            clearSidebarPopupGroups(scope.id)
        },
        [clearSidebarPopupGroups, scope.id],
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
