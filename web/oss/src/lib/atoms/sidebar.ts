import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

const SIDEBAR_OPEN_GROUPS_STORAGE_KEY = "agenta:sidebar:open-groups"
const NO_PROJECT_SCOPE = "__global__"

export const sidebarCollapsedAtom = atomWithStorage<boolean>("sidebarCollapsed", false)

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
