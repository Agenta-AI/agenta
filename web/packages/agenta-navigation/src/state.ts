import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithStorage, createJSONStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

const SIDEBAR_OPEN_GROUPS_STORAGE_KEY = "agenta:sidebar:open-groups"
const SIDEBAR_COLLAPSED_STORAGE_KEY = "agenta:sidebar:collapsed"
const SIDEBAR_WIDTH_STORAGE_KEY = "agenta:sidebar:width"
const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebarCollapsed"
const NO_PROJECT_SCOPE = "__global__"

export const SIDEBAR_COLLAPSED_WIDTH = 48
export const SIDEBAR_DEFAULT_WIDTH = 255
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 340

export const clampSidebarWidth = (width: number) =>
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))

const jsonBooleanStorage = createJSONStorage<boolean>(() => localStorage)
const sidebarCollapsedStorage = {
    getItem: (key: string, initialValue: boolean) => {
        if (typeof window === "undefined") return initialValue
        if (window.localStorage.getItem(key) !== null) {
            return jsonBooleanStorage.getItem(key, initialValue)
        }
        if (window.localStorage.getItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY) === null) {
            return initialValue
        }

        const legacyValue = jsonBooleanStorage.getItem(
            LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY,
            initialValue,
        )
        jsonBooleanStorage.setItem(key, legacyValue)
        jsonBooleanStorage.removeItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY)
        return legacyValue
    },
    setItem: (key: string, value: boolean) => jsonBooleanStorage.setItem(key, value),
    removeItem: (key: string) => jsonBooleanStorage.removeItem(key),
    subscribe: jsonBooleanStorage.subscribe,
}

export const sidebarCollapsedAtom = atomWithStorage<boolean>(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    false,
    sidebarCollapsedStorage,
)
const jsonNumberStorage = createJSONStorage<number>(() => localStorage)
// Clamped on read too, so a width persisted under an older range can never leak through.
const sidebarWidthStorage = {
    ...jsonNumberStorage,
    getItem: (key: string, initialValue: number) => {
        const stored = jsonNumberStorage.getItem(key, initialValue)
        return typeof stored === "number" && Number.isFinite(stored)
            ? clampSidebarWidth(stored)
            : initialValue
    },
    setItem: (key: string, value: number) =>
        jsonNumberStorage.setItem(key, clampSidebarWidth(value)),
}

export const sidebarWidthAtom = atomWithStorage<number>(
    SIDEBAR_WIDTH_STORAGE_KEY,
    SIDEBAR_DEFAULT_WIDTH,
    sidebarWidthStorage,
)

export const sidebarPopupGroupsAtomFamily = atomFamily((_scopeId: string) => atom<string[]>([]))

/**
 * Whether the shell is rendering this scope as a collapsed icon rail, published per scope.
 *
 * Per scope rather than read off a global: each host hands `SidebarShell` its OWN collapsed atom
 * (the mobile drawer passes an expanded flag that is never the desktop rail's), so only the shell
 * knows which state a given scope is in.
 */
export const sidebarCollapsedScopeAtomFamily = atomFamily((_scopeId: string) => atom(false))

/**
 * The `defaultOpen` keys the shell is currently displaying as expanded, published per scope.
 * Not persisted: it mirrors what the user SEES so the gated entity sources agree with the
 * screen. Seeding the persisted atom instead would clobber it before storage hydrates.
 */
export const sidebarDefaultOpenGroupsAtomFamily = atomFamily((_scopeId: string) =>
    atom<string[]>([]),
)

/**
 * Groups the shell renders as ALWAYS open, published per scope.
 *
 * Separate from the `defaultOpen` set on purpose: the gate reads persisted keys `??` defaults, so
 * once a scope has any persisted record the defaults stop applying. An `alwaysOpen` group cannot
 * be collapsed, so its key is never in the persisted set, and it has to be ORed in rather than
 * fall back to. Without this the desktop rail showed "Open to load" forever.
 */
export const sidebarAlwaysOpenGroupsAtomFamily = atomFamily((_scopeId: string) =>
    atom<string[]>([]),
)

export const setSidebarPopupGroupOpenAtom = atom(
    null,
    (get, set, {scopeId, key, open}: {scopeId: string; key: string; open: boolean}) => {
        const popupGroupsAtom = sidebarPopupGroupsAtomFamily(scopeId)
        const currentKeys = get(popupGroupsAtom)
        const nextKeys = open
            ? Array.from(new Set([...currentKeys, key]))
            : currentKeys.filter((currentKey) => currentKey !== key)

        set(popupGroupsAtom, nextKeys)
    },
)

export const clearSidebarPopupGroupsAtom = atom(null, (_get, set, scopeId: string) => {
    set(sidebarPopupGroupsAtomFamily(scopeId), [])
})

const sidebarOpenGroupsStorageAtom = atomWithStorage<Record<string, string[]>>(
    SIDEBAR_OPEN_GROUPS_STORAGE_KEY,
    {},
)

const getSidebarOpenGroupsStorageScope = (scopeId: string, projectId: string | null) =>
    `${scopeId}:${projectId || NO_PROJECT_SCOPE}`

export const sidebarOpenGroupsAtomFamily = atomFamily((scopeId: string) =>
    atom(
        (get) => {
            const storageScope = getSidebarOpenGroupsStorageScope(scopeId, get(projectIdAtom))
            const storage = get(sidebarOpenGroupsStorageAtom)
            return storage[storageScope]
        },
        (get, set, nextOpenKeys: string[]) => {
            const storageScope = getSidebarOpenGroupsStorageScope(scopeId, get(projectIdAtom))
            const storage = get(sidebarOpenGroupsStorageAtom)
            set(sidebarOpenGroupsStorageAtom, {...storage, [storageScope]: nextOpenKeys})
        },
    ),
)
