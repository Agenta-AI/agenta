import {projectIdAtom} from "@agenta/shared/state"
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

// Eagerly initialize projectIdAtom from the URL-parsed initial location.
// This ensures entity package queries (which depend on projectIdAtom) are enabled
// during the very first render pass, before React effects fire.
// Without this, projectIdAtom stays null until the effect phase (setLocationAtom call),
// causing a visible loading delay — especially on slower connections (staging, prod).
if (initialParsedLocation.projectId) {
    getDefaultStore().set(projectIdAtom, initialParsedLocation.projectId)
}

export const appStateSnapshotAtom = atom<AppStateSnapshot>(initialSnapshot)

export const setLocationAtom = atom(null, (_get, set, location: ParsedAppLocation) => {
    set(appStateSnapshotAtom, {
        ...location,
        timestamp: Date.now(),
    })
    // Sync projectId to shared atom so entity packages can read it
    set(setSharedProjectIdAtom, location.projectId ?? null)
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
