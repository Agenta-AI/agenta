import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

export interface AppCreationStatus {
    status: string
    details?: unknown
    appId?: string
}

export interface AppCreationMessage {
    type: "error" | "success" | "loading"
    message: string
    errorMessage?: string
}

export const appCreationInitialStatus: AppCreationStatus = {
    status: "",
    details: undefined,
    appId: undefined,
}
const statusAtom = atomWithImmer<AppCreationStatus>(appCreationInitialStatus)

export type AppCreationStatusUpdate =
    | Partial<AppCreationStatus>
    | ((prev: AppCreationStatus) => AppCreationStatus)

export const appCreationStatusAtom = atom(
    (get) => get(statusAtom),
    (_get, set, update: AppCreationStatusUpdate) => {
        if (typeof update === "function") {
            set(statusAtom, (draft) => {
                const result = update({...draft})
                if (result) {
                    draft.status = result.status
                    draft.details = result.details
                    draft.appId = result.appId
                }
            })
        } else if (update) {
            set(statusAtom, (draft) => {
                if (update.status !== undefined) draft.status = update.status
                if (update.details !== undefined) draft.details = update.details
                if (update.appId !== undefined) draft.appId = update.appId
            })
        } else {
            set(statusAtom, () => appCreationInitialStatus)
        }
    },
)

const messagesAtom = atomWithImmer<Record<string, AppCreationMessage>>({})

export type AppCreationMessagesUpdate =
    | Record<string, AppCreationMessage>
    | ((prev: Record<string, AppCreationMessage>) => Record<string, AppCreationMessage>)

export const appCreationMessagesAtom = atom(
    (get) => get(messagesAtom),
    (_get, set, update: AppCreationMessagesUpdate) => {
        if (typeof update === "function") {
            set(messagesAtom, update)
        } else {
            set(messagesAtom, () => update)
        }
    },
)

const navigationAtom = atom<string | null>(null)

export const appCreationNavigationAtom = atom(
    (get) => get(navigationAtom),
    (_get, set, next: string | null) => {
        set(navigationAtom, next)
    },
)

export const resetAppCreationAtom = atom(null, (_get, set) => {
    set(statusAtom, () => appCreationInitialStatus)
    set(messagesAtom, () => ({}))
    set(navigationAtom, null)
})
