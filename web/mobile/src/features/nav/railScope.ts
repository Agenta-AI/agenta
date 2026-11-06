import {useEffect, useMemo, useState} from "react"

import type {SidebarScope} from "@agenta/navigation"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {appScopeAppId, lastMainRailPathAtom} from "./appRoute"
import {useMobileNavScope} from "./mobileNavScope"

/** The app a page shows in the app menu: beta developer mode only, and only on an app page. */
const useAppMenuAppId = (): string | null => {
    const router = useRouter()
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    return developerMode ? appScopeAppId(router.pathname, router.query) : null
}

type AppMenuModule = typeof import("./appNavScope")

/**
 * The app menu's code, loaded the first time a page needs it: pages without an app (and every
 * page outside beta developer mode) never download it.
 */
const useAppMenuModule = (needed: boolean): AppMenuModule | null => {
    const [loaded, setLoaded] = useState<AppMenuModule | null>(null)
    useEffect(() => {
        if (!needed || loaded) return
        let live = true
        void import("./appNavScope").then((module) => {
            if (live) setLoaded(module)
        })
        return () => {
            live = false
        }
    }, [loaded, needed])
    return loaded
}

/** The rail for the docked rail and the drawer: the screen's scope, else the app menu, else main. */
export const useRailScope = (
    workspaceId: string,
    projectId: string,
    scopeOverride?: SidebarScope,
): SidebarScope => {
    const mainScope = useMobileNavScope(workspaceId, projectId)
    const appId = useAppMenuAppId()
    const appMenu = useAppMenuModule(appId !== null)
    const appScope = useMemo(
        () =>
            appId && appMenu
                ? appMenu.createMobileAppNavScope(workspaceId, projectId, appId)
                : null,
        [appId, appMenu, projectId, workspaceId],
    )
    return scopeOverride ?? appScope ?? mainScope
}

/** Records the last page the main rail showed, where the app menu's "Back" returns. */
export const useTrackLastMainRailPath = () => {
    const router = useRouter()
    const setLastPath = useSetAtom(lastMainRailPathAtom)
    const inAppMenu = useAppMenuAppId() !== null
    useEffect(() => {
        const settings = router.asPath.split("?")[0].endsWith("/settings")
        if (!inAppMenu && !settings) setLastPath(router.asPath)
    }, [inAppMenu, router.asPath, setLastPath])
}
