import {useEffect} from "react"

import type {SidebarScope} from "@agenta/navigation"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {appScopeAppId, lastMainRailPathAtom, useMobileAppNavScope} from "./appNavScope"
import {useMobileNavScope} from "./mobileNavScope"

/** The app a page shows in the app menu: beta developer mode only, and only on an app page. */
const useAppMenuAppId = (): string | null => {
    const router = useRouter()
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    return developerMode ? appScopeAppId(router.pathname, router.query) : null
}

/**
 * The rail a page shows, for the docked rail and the drawer alike: the screen's own scope
 * (settings), else the app menu inside an app in beta developer mode, else the main rail.
 */
export const useRailScope = (
    workspaceId: string,
    projectId: string,
    scopeOverride?: SidebarScope,
): SidebarScope => {
    const mainScope = useMobileNavScope(workspaceId, projectId)
    const appScope = useMobileAppNavScope(workspaceId, projectId, useAppMenuAppId())
    return scopeOverride ?? appScope ?? mainScope
}

/**
 * Records the last page the main rail showed, where the app menu's "Back" returns. Called once,
 * by the AppShell every screen wraps.
 */
export const useTrackLastMainRailPath = () => {
    const router = useRouter()
    const setLastPath = useSetAtom(lastMainRailPathAtom)
    const inAppMenu = useAppMenuAppId() !== null
    useEffect(() => {
        const settings = router.asPath.split("?")[0].endsWith("/settings")
        if (!inAppMenu && !settings) setLastPath(router.asPath)
    }, [inAppMenu, router.asPath, setLastPath])
}
