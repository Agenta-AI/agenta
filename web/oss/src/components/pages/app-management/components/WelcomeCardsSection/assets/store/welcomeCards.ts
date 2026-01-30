import {atomWithStorage} from "jotai/utils"

const STORAGE_KEY = "agenta:app-management:welcome-cards-dismissed"

export const welcomeCardsDismissedAtom = atomWithStorage<boolean>(STORAGE_KEY, false)
