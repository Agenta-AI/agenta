import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/**
 * Window Configuration Atoms
 * Pure atoms for managing windowing/pagination state
 */

export interface WindowConfig {
    offset: number
    limit: number
    hasMore: boolean
    total: number
    isLoading: boolean
}

export interface WindowAction {
    type: "next" | "reset" | "setTotal" | "setLoading"
    payload?: any
}

// Window configuration atom family - one per window key
export const windowConfigAtom = atomFamily((key: string) =>
    atom<WindowConfig>({
        offset: 0,
        limit: 50,
        hasMore: true,
        total: 0,
        isLoading: false,
    }),
)

// Window actions atom family - handles window state mutations
export const windowActionsAtom = atomFamily((key: string) =>
    atom(null, (get, set, action: WindowAction) => {
        const current = get(windowConfigAtom(key))

        switch (action.type) {
            case "next":
                if (current.hasMore && !current.isLoading) {
                    set(windowConfigAtom(key), {
                        ...current,
                        offset: current.offset + current.limit,
                        isLoading: true,
                    })
                }
                break

            case "reset":
                set(windowConfigAtom(key), {
                    offset: 0,
                    limit: 50,
                    hasMore: true,
                    total: 0,
                    isLoading: false,
                })
                break

            case "setTotal":
                set(windowConfigAtom(key), {
                    ...current,
                    total: action.payload.total,
                    hasMore: action.payload.hasMore,
                    isLoading: false,
                })
                break

            case "setLoading":
                set(windowConfigAtom(key), {
                    ...current,
                    isLoading: action.payload.isLoading,
                })
                break
        }
    }),
)

// Derived atoms for common window calculations
export const windowMetadataAtom = atomFamily((key: string) =>
    atom((get) => {
        const config = get(windowConfigAtom(key))

        return {
            currentPage: Math.floor(config.offset / config.limit) + 1,
            totalPages: Math.ceil(config.total / config.limit),
            pageSize: config.limit,
            startIndex: config.offset,
            endIndex: Math.min(config.offset + config.limit, config.total),
            canLoadMore: config.hasMore,
            progress: config.total > 0 ? (config.offset + config.limit) / config.total : 0,
        }
    }),
)
