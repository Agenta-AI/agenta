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

const initialSnapshot: AppStateSnapshot = {
    ...initialParsedLocation,
    timestamp: Date.now(),
}

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
// If a projectId is present in the URL, the user must be on an authenticated
// route (ProtectedRoute guards all /w/.../p/... pages), so we can safely
// pre-set sessionAtom. SessionListener will confirm the real auth state once
// React effects fire — if it's actually false, ProtectedRoute redirects to
// login before the optimistic queries matter.
if (initialParsedLocation.projectId) {
    const store = getDefaultStore()
    store.set(projectIdAtom, initialParsedLocation.projectId)
    store.set(sessionAtom, true)
}

export const appStateSnapshotAtom = atom<AppStateSnapshot>(initialSnapshot)

export const setLocationAtom = atom(null, (_get, set, location: ParsedAppLocation) => {
    set(appStateSnapshotAtom, {
        ...location,
        timestamp: Date.now(),
    })
    // Sync projectId to shared atom so entity packages can read it
    set(setSharedProjectIdAtom, location.projectId ?? null)
    // Keep sessionAtom in sync: if projectId is present in the URL the user
    // is on an authenticated route, so entity queries should be enabled.
    // SessionListener provides the authoritative value via useEffect,
    // but this ensures queries are not blocked during SPA navigation.
    if (location.projectId) {
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

export const navigationRequestAtom = atom<NavigationCommand | null>(null)

export const requestNavigationAtom = atom(
    (get) => get(navigationRequestAtom),
    (_get, set, command: NavigationCommand | null) => {
        set(navigationRequestAtom, command)
    },
)
