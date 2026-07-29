import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {setProjectIdAtom as setSharedProjectIdAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"

import {createInitialParsedLocation} from "./parse"
import type {
    AppIdentifiers,
    AppStateSnapshot,
    NavigationCommand,
    ParsedAppLocation,
    RouteLayer,
} from "./types"

const initialParsedLocation = createInitialParsedLocation()

const initialSnapshot: AppStateSnapshot = initialParsedLocation

// Eagerly initialize projectIdAtom and sessionAtom from the URL-parsed initial
// location. Both entity-package queries and oss queries gate on these atoms,
// and now share a single sessionAtom (oss's sessionExistsAtom is a re-export
// of @agenta/shared/state's sessionAtom — see state/session/atoms.ts). Setting
// it once here unblocks every gated query on the first render pass, before
// React effects fire.
//
// Without this, the atoms stay at their defaults (null / false) until
// SessionListener's effect runs, which produces a visible flake:
// projectsQueryAtom is gated on sessionExistsAtom, so the demo-workspace
// banner (which needs project?.is_demo) can't render until the effect tick
// completes and the projects fetch returns. That's the "banner missing on
// reload" race users have reported.
//
// Only pre-set sessionAtom for a true project route (/w/<ws>/p/<proj>/...,
// routeLayer === "project"), which ProtectedRoute guards. A bare project_id in
// the query string is NOT proof of auth: the invite link
// /workspaces/accept?...&project_id=... carries one while the visitor is logged
// out, and optimistically setting sessionAtom there fabricates a ghost session
// whose gated queries then 401-storm. The accept page handles its own auth.
if (initialParsedLocation.projectId) {
    const store = getDefaultStore()
    store.set(projectIdAtom, initialParsedLocation.projectId)
    if (initialParsedLocation.routeLayer === "project") {
        store.set(sessionAtom, true)
    }
}

export const appStateSnapshotAtom = atom<AppStateSnapshot>(initialSnapshot)

export const setLocationAtom = atom(null, (_get, set, location: ParsedAppLocation) => {
    set(appStateSnapshotAtom, location)
    // Sync projectId to shared atom so entity packages can read it
    set(setSharedProjectIdAtom, location.projectId ?? null)
    // Keep sessionAtom in sync only on a true project route (path-param
    // /w/.../p/..., routeLayer === "project"), which ProtectedRoute guards. A
    // query-string project_id (e.g. the logged-out invite link) must not flip
    // the session on, or its gated queries 401-storm. SessionListener provides
    // the authoritative value via useEffect.
    if (location.projectId && location.routeLayer === "project") {
        set(sessionAtom, true)
    }
})

export const appIdentifiersAtom = atom<AppIdentifiers>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    return {
        workspaceId: snapshot.workspaceId,
        projectId: snapshot.projectId,
        appId: snapshot.appId,
    }
})

export const routeLayerAtom = atom<RouteLayer>((get) => get(appStateSnapshotAtom).routeLayer)

// String-valued route selector: subscribers re-render only when asPath changes
export const appAsPathAtom = atom<string>((get) => get(appStateSnapshotAtom).asPath)

export const navigationRequestAtom = atom<NavigationCommand | null>(null)

export const requestNavigationAtom = atom(
    (get) => get(navigationRequestAtom),
    (_get, set, command: NavigationCommand | null) => {
        set(navigationRequestAtom, command)
    },
)
