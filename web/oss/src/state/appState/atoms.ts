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

// Eagerly initialize projectIdAtom and sessionAtom from the URL-parsed initial location.
// This ensures entity package queries (which depend on both atoms) are enabled
// during the very first render pass, before React effects fire.
// Without this, these atoms stay at their defaults (null / false) until the effect phase,
// causing entity queries to stay disabled — especially on pages like evaluations
// where queries depend on sessionAtom + projectIdAtom being set.
//
// If a projectId is present in the URL, the user must be on an authenticated route
// (ProtectedRoute guards all /w/.../p/... pages), so we can safely pre-set sessionAtom.
// SessionListener will confirm the real auth state once React effects fire.
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
