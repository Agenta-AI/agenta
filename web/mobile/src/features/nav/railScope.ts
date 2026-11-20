import {useEffect, useMemo, useRef, useState} from "react"

import type {SidebarScope} from "@agenta/navigation"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useSelectedSidebar} from "../agent-sidebar/selectedSidebar"

import {appScopeAppId, lastMainRailPathAtom} from "./appRoute"
import {useMobileNavScope} from "./mobileNavScope"

/** The app a page shows in the app menu: beta developer mode only, and only on an app page. */
const useAppMenuAppId = (): string | null => {
    const router = useRouter()
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    return developerMode ? appScopeAppId(router.pathname, router.query) : null
}

/**
 * A module loaded the first time `needed` turns true, and kept after. Pages that never need it
 * never download it: the app menu (beta developer mode, inside an app) and the agent sidebar.
 */
const useLazyModule = <T>(needed: boolean, load: () => Promise<T>): T | null => {
    const [loaded, setLoaded] = useState<T | null>(null)
    useEffect(() => {
        if (!needed || loaded) return
        let live = true
        // A failed load (a stale chunk after a deploy) leaves the current rail in place.
        load().then(
            (module) => {
                if (live) setLoaded(module)
            },
            () => undefined,
        )
        return () => {
            live = false
        }
        // `load` is a fixed import per call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, needed])
    return loaded
}

const loadAppMenu = () => import("./appNavScope")
const loadAgentSidebar = () => import("../agent-sidebar/agentSidebarScope")

/**
 * The rail for the docked rail and the drawer: the screen's scope, else the agent sidebar this
 * tab selected, else the app menu, else main.
 */
export const useRailScope = (
    workspaceId: string,
    projectId: string,
    scopeOverride?: SidebarScope,
): SidebarScope => {
    const mainScope = useMobileNavScope(workspaceId, projectId)
    const selected = useSelectedSidebar()
    const agentId = selected.kind === "agent" ? selected.agentId : null
    const agentSidebar = useLazyModule(agentId !== null, loadAgentSidebar)
    const agentScope = useMemo(
        () =>
            agentId && agentSidebar
                ? agentSidebar.createAgentSidebarScope(workspaceId, projectId, agentId)
                : null,
        [agentId, agentSidebar, projectId, workspaceId],
    )
    const appId = useAppMenuAppId()
    const appMenu = useLazyModule(appId !== null, loadAppMenu)
    const appScope = useMemo(
        () =>
            appId && appMenu
                ? appMenu.createMobileAppNavScope(workspaceId, projectId, appId)
                : null,
        [appId, appMenu, projectId, workspaceId],
    )
    return scopeOverride ?? agentScope ?? appScope ?? mainScope
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

const isAgentSidebar = (scopeId: string) => scopeId.startsWith("agent-sidebar:")

/**
 * The side a new rail slides in from (A11, A12): focusing on one agent slides the agent sidebar
 * in from the end, and leaving it slides the other sidebar in from the start. A first mount and
 * a move from one agent's sidebar to another's do not slide.
 */
export const sidebarEnterFrom = (
    previousScopeId: string | null,
    scopeId: string,
): "start" | "end" | undefined => {
    if (previousScopeId === null || previousScopeId === scopeId) return undefined
    const from = isAgentSidebar(previousScopeId)
    const to = isAgentSidebar(scopeId)
    if (to && !from) return "end"
    if (from && !to) return "start"
    return undefined
}

/** `sidebarEnterFrom` for the scope on screen, against the one shown before it. */
export const useSidebarEnterFrom = (scopeId: string) => {
    const previous = useRef<string | null>(null)
    const enterFrom = useMemo(
        () => sidebarEnterFrom(previous.current, scopeId),
        // Read once per scope change; the ref moves in the effect below.

        [scopeId],
    )
    useEffect(() => {
        previous.current = scopeId
    }, [scopeId])
    return enterFrom
}
