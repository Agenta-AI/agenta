import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily, atomWithStorage, createJSONStorage} from "jotai/utils"

const SIDEBAR_OPEN_GROUPS_STORAGE_KEY = "agenta:sidebar:open-groups"
const SIDEBAR_COLLAPSED_STORAGE_KEY = "agenta:sidebar:collapsed"
const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebarCollapsed"
const NO_PROJECT_SCOPE = "__global__"

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
export const sidebarPopupGroupsAtomFamily = atomFamily((_scopeId: string) => atom<string[]>([]))

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
